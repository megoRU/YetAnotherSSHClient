//! Files dragged out into Explorer, onto the desktop or into any folder (Windows).
//!
//! They are not on this computer yet: the drag offers *virtual files*, the way an e-mail
//! attachment or a file in an archive is dragged out. The drop target asks for the list of
//! what is dragged (`FileGroupDescriptorW`) when it needs it, and for a stream of each file's
//! content (`FileContents`) as it copies them; Explorer copies them as it copies its own, with
//! its progress window, and asks before it replaces anything. What is dragged and the content
//! of its files come from a [`Source`].
//!
//! The data object and its streams live in the process's multithreaded apartment. Explorer
//! calls them from its own process and COM runs those calls on its threads there, so waiting
//! for a file's content (from the network) blocks one of those, never the window's thread.
//! Explorer copies in the background too (`IDataObjectAsyncCapability`): the drag ends as soon
//! as the files are dropped.
#![cfg(windows)]

mod data;
mod image;
mod stream;

use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use windows::Win32::Foundation::{
    DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, POINT, POINTL,
    S_OK,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, IDataObject,
};
use windows::Win32::System::Ole::{
    DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, DoDragDrop, IDropSource, IDropSource_Impl,
    IDropTarget, OleInitialize, OleUninitialize,
};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MK_RBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Shell::{
    BHID_SFUIObject, CLSID_DragDropHelper, IDragSourceHelper, IShellItem, SHDRAGIMAGE,
    SHCreateItemFromParsingName,
};
use windows::Win32::Graphics::Gdi::{GetObjectW, BITMAP};
use windows::Win32::UI::WindowsAndMessaging::{
    GA_ROOT, GetAncestor, GetCursorPos, IDC_NO, LoadCursorW, SetCursor, WindowFromPoint,
};
use windows::core::{BOOL, HRESULT, HSTRING, Result};
use windows_core::implement;

/// The longest [`Item::path`] a drop takes, in UTF-16 units (Windows' `MAX_PATH`, less the
/// terminating zero): longer ones are left out.
pub const MAX_PATH_LEN: usize = 259;

/// A file or folder of a drag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// Where it goes, relative to where it is dropped: names valid on Windows, `\` between them.
    pub path: String,
    pub folder: bool,
    /// 0 for folders.
    pub size: u64,
    /// Seconds since the Unix epoch.
    pub modified: Option<u64>,
}

/// How the copy of dropped files ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ended {
    Done,
    /// Stopped by the user: in Explorer's progress window, or here (a reader failed with
    /// `ErrorKind::ConnectionAborted`).
    Cancelled,
    Failed(String),
}

/// What a drag holds. Its methods are called on COM's threads, and may block.
pub trait Source: Send + Sync + 'static {
    /// The files and folders, each folder before what is inside it. Asked for once, when the
    /// drop target first wants it (which may be while the drag passes over it).
    fn items(&self) -> std::result::Result<Vec<Item>, String>;

    /// The content of the file `index` of [`Source::items`], read as the target copies it. A
    /// read that fails with `ErrorKind::ConnectionAborted` tells the target the copy was
    /// cancelled.
    fn open(&self, index: usize) -> std::io::Result<Box<dyn Read + Send>>;

    /// Called when the drop target accepts the files and starts copying them.
    fn started(&self);

    /// The target is done with the files; called once, after a drop.
    fn finished(&self, ended: Ended);
}

/// How a drag ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Dropped where files are taken: [`Source::finished`] says when they have been.
    Dropped,
    /// Cancelled (Esc, the right button), or released where no files are taken or over the
    /// window the drag came from.
    Cancelled,
}

/// Drags what `source` holds out of `window` (a top-level window). Call it on the window's
/// thread while the left mouse button is down; it returns when the button is released or the
/// drag is cancelled. A release over `window` itself cancels it: what is in the window would
/// take the files back. Dropped files may still be copying when it returns.
pub fn drag(window: isize, source: Arc<dyn Source>, image: &[u8]) -> Result<Outcome> {
    // Dragging needs OLE, which a window's thread has only if the window takes drops itself;
    // it is set up for the drag (or counted once more where it is).
    // SAFETY: on this thread, balanced below.
    unsafe { OleInitialize(None) }?;
    let outcome = drag_with_ole(HWND(window as _), source, image);
    // SAFETY: balances the call above, on the same thread.
    unsafe { OleUninitialize() };
    outcome
}

fn drag_with_ole(window: HWND, source: Arc<dyn Source>, image: &[u8]) -> Result<Outcome> {
    let shared = Arc::new(Shared::new(source));
    let data = data::create(Arc::clone(&shared))?;
    if let Ok(bitmap) = image::read_bytes_to_hbitmap(image) {
        let mut dimensions = BITMAP::default();
        let copied = unsafe {
            GetObjectW(
                bitmap.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some((&mut dimensions as *mut BITMAP).cast()),
            )
        };
        if copied != 0 {
            let drag_image = SHDRAGIMAGE {
                sizeDragImage: windows::Win32::Foundation::SIZE {
                    cx: dimensions.bmWidth,
                    cy: dimensions.bmHeight,
                },
                ptOffset: POINT::default(),
                hbmpDragImage: bitmap,
                crColorKey: windows::Win32::Foundation::COLORREF(0),
            };
            if let Ok(helper) = unsafe {
                CoCreateInstance::<_, IDragSourceHelper>(
                    &CLSID_DragDropHelper,
                    None,
                    CLSCTX_INPROC_SERVER,
                )
            } {
                let _ = unsafe { helper.InitializeFromBitmap(&drag_image, &data) };
            }
        }
    }
    let drop_source: IDropSource = DropSource { window }.into();
    let mut effect = DROPEFFECT_NONE;
    // SAFETY: both objects stay alive for the call, on the thread that made the drop source.
    let result = unsafe { DoDragDrop(&data, &drop_source, DROPEFFECT_COPY, &mut effect) };
    if result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE {
        shared.dropped();
        Ok(Outcome::Dropped)
    } else if result == DRAGDROP_S_DROP || result == DRAGDROP_S_CANCEL {
        Ok(Outcome::Cancelled)
    } else {
        Err(result.into())
    }
}

/// Drops what `source` holds into `folder` as if it were dragged there, through the shell's
/// own drop target for the folder (the one Explorer uses): a drop made without the mouse, for
/// tests. Call it on a thread of a single-threaded apartment that runs its messages, as a
/// window's thread does.
pub fn drop_into(folder: &Path, source: Arc<dyn Source>) -> Result<Outcome> {
    let shared = Arc::new(Shared::new(source));
    let data: IDataObject = data::create(Arc::clone(&shared))?;
    let path = HSTRING::from(folder.as_os_str());
    let mut effect = DROPEFFECT_COPY;
    // SAFETY: COM calls on live objects, on this thread.
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(&path, None)?;
        let target: IDropTarget = item.BindToHandler(None, &BHID_SFUIObject)?;
        target.DragEnter(&data, MK_LBUTTON, POINTL::default(), &mut effect)?;
        if effect == DROPEFFECT_NONE {
            target.DragLeave()?;
            return Ok(Outcome::Cancelled);
        }
        target.DragOver(MK_LBUTTON, POINTL::default(), &mut effect)?;
        target.Drop(&data, MODIFIERKEYS_FLAGS(0), POINTL::default(), &mut effect)?;
    }
    if effect == DROPEFFECT_NONE {
        return Ok(Outcome::Cancelled);
    }
    shared.dropped();
    Ok(Outcome::Dropped)
}

/// What a drag, its data object and the streams of its files share.
pub(crate) struct Shared {
    pub(crate) source: Arc<dyn Source>,
    /// The drop is made.
    dropped: AtomicBool,
    /// The target copies in the background: it called `StartOperation`.
    background: AtomicBool,
    finished: AtomicBool,
    /// How the first file that could not be read ended the copy.
    failure: Mutex<Option<Ended>>,
}

impl Shared {
    fn new(source: Arc<dyn Source>) -> Shared {
        Shared {
            source,
            dropped: AtomicBool::new(false),
            background: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            failure: Mutex::new(None),
        }
    }

    /// A file could not be read: the copy ends so, whatever the target says (Explorer may go
    /// on without it).
    pub(crate) fn failed(&self, ended: Ended) {
        lock(&self.failure).get_or_insert(ended);
    }

    pub(crate) fn started(&self) {
        self.background.store(true, Ordering::SeqCst);
        self.source.started();
    }

    pub(crate) fn finish(&self, ended: Ended) {
        if self.finished.swap(true, Ordering::SeqCst) {
            return;
        }
        let failure = lock(&self.failure).take();
        let ended = match ended {
            Ended::Cancelled => Ended::Cancelled,
            other => failure.unwrap_or(other),
        };
        self.source.finished(ended);
    }

    /// The drop is made: a target that does not copy in the background has copied already.
    fn dropped(&self) {
        self.dropped.store(true, Ordering::SeqCst);
        if !self.background.load(Ordering::SeqCst) {
            self.source.started();
            self.finish(Ended::Done);
        }
    }

    /// The data object is released: the target is done with it, if it got it.
    pub(crate) fn released(&self) {
        if self.dropped.load(Ordering::SeqCst) || self.background.load(Ordering::SeqCst) {
            self.finish(Ended::Done);
        }
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs `task` on a thread of the process's multithreaded apartment. The thread stays for
/// good: the apartment, and the objects made in it, would go with its last thread.
pub(crate) fn in_mta<T: Send + 'static>(task: impl FnOnce() -> T + Send + 'static) -> T {
    type Task = Box<dyn FnOnce() + Send>;
    static THREAD: OnceLock<Sender<Task>> = OnceLock::new();
    let thread = THREAD.get_or_init(|| {
        let (tasks, next) = channel::<Task>();
        std::thread::Builder::new()
            .name("drag-out".into())
            .spawn(move || {
                // SAFETY: initializes COM for this thread, which never leaves the apartment.
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                for task in next {
                    task();
                }
            })
            .expect("a thread for files dragged out");
        tasks
    });
    let (answer, result) = channel();
    thread
        .send(Box::new(move || {
            let _ = answer.send(task());
        }))
        .expect("the drag-out thread runs for good");
    result.recv().expect("the drag-out thread runs for good")
}

/// The drag's side of the drop: cancelled by Esc or the right button, and over `window`.
#[implement(IDropSource)]
struct DropSource {
    window: HWND,
}

impl IDropSource_Impl for DropSource_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() || keys.0 & MK_RBUTTON.0 != 0 {
            DRAGDROP_S_CANCEL
        } else if keys.0 & MK_LBUTTON.0 != 0 {
            S_OK
        } else if over(self.window) {
            // The source window advertises a forbidden cursor while dragging. If the
            // button is released there, treat that as cancellation rather than success.
            DRAGDROP_S_CANCEL
        } else {
            DRAGDROP_S_DROP
        }
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        if over(self.window) {
            // Keep the OLE drag alive over its source window and show Windows' native
            // forbidden cursor there. CSS cursor styles cannot affect an active OLE drag.
            if let Ok(cursor) = unsafe { LoadCursorW(None, IDC_NO) } {
                unsafe { SetCursor(Some(cursor)) };
            }
            S_OK
        } else {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }
}

/// Whether the mouse is over `window`, or a window inside it (such as a web view's).
fn over(window: HWND) -> bool {
    let mut point = POINT::default();
    // SAFETY: plain Win32 calls; `point` outlives them.
    unsafe {
        GetCursorPos(&mut point).is_ok() && GetAncestor(WindowFromPoint(point), GA_ROOT) == window
    }
}
