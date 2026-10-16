//! The data object of a drag: the list of what it holds (`FileGroupDescriptorW`), a stream of
//! each file's content (`FileContents`), and what the shell puts in it (its drag image).

use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use windows::Win32::Foundation::{
    DATA_S_SAMEFORMATETC, DV_E_FORMATETC, DV_E_LINDEX, E_ABORT, E_FAIL, E_INVALIDARG, E_NOTIMPL,
    E_OUTOFMEMORY, ERROR_CANCELLED, FILETIME, GlobalFree, HGLOBAL, OLE_E_ADVISENOTSUPPORTED, S_OK,
};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::System::Com::Marshal::CoMarshalInterThreadInterfaceInStream;
use windows::Win32::System::Com::StructuredStorage::CoGetInterfaceAndReleaseStream;
use windows::Win32::System::Com::{
    DATADIR_GET, DVASPECT_CONTENT, FORMATETC, IAdviseSink, IBindCtx, IDataObject, IDataObject_Impl,
    IEnumFORMATETC, IEnumSTATDATA, IStream, STGMEDIUM, STGMEDIUM_0, TYMED, TYMED_HGLOBAL,
    TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::Win32::System::Ole::{DROPEFFECT_COPY, ReleaseStgMedium};
use windows::Win32::UI::Shell::{
    CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW, CFSTR_PREFERREDDROPEFFECT, FD_ATTRIBUTES,
    FD_FILESIZE, FD_PROGRESSUI, FD_UNICODE, FD_WRITESTIME, FILEDESCRIPTORW,
    IDataObjectAsyncCapability, IDataObjectAsyncCapability_Impl, SHCreateStdEnumFmtEtc,
};
use windows::core::{BOOL, HRESULT, Interface, Ref, Result};
use windows_core::implement;

use crate::stream::{Stream, ended_by};
use crate::{Ended, Item, MAX_PATH_LEN, Shared, lock};

/// Makes the data object in the multithreaded apartment and returns it for this thread.
pub(crate) fn create(shared: Arc<Shared>) -> Result<IDataObject> {
    /// The object marshaled for another thread of this process.
    struct Packet(IStream);
    // SAFETY: the stream is a buffer made to be passed to another thread, used there once.
    unsafe impl Send for Packet {}

    let packet = crate::in_mta(move || {
        let object: IDataObject = DataObject {
            shared,
            entries: OnceLock::new(),
            stored: Mutex::new(Vec::new()),
            asynchronous: AtomicBool::new(true),
            in_operation: AtomicBool::new(false),
        }
        .into();
        // SAFETY: marshals a live object.
        unsafe { CoMarshalInterThreadInterfaceInStream(&IDataObject::IID, &object) }
            .map(Packet)
            .map_err(|e| e.code())
    })?;
    // SAFETY: the stream holds what CoMarshalInterThreadInterfaceInStream wrote, taken once.
    let object = unsafe { CoGetInterfaceAndReleaseStream::<_, IDataObject>(&packet.0) };
    // The call released the stream itself.
    std::mem::forget(packet);
    object
}

/// The clipboard formats of a drag.
struct Formats {
    descriptor: u16,
    contents: u16,
    effect: u16,
}

fn formats() -> &'static Formats {
    static FORMATS: OnceLock<Formats> = OnceLock::new();
    FORMATS.get_or_init(|| {
        // SAFETY: registers a name; the IDs of registered formats fit in 16 bits.
        let id = |name| unsafe { RegisterClipboardFormatW(name) } as u16;
        Formats {
            descriptor: id(CFSTR_FILEDESCRIPTORW),
            contents: id(CFSTR_FILECONTENTS),
            effect: id(CFSTR_PREFERREDDROPEFFECT),
        }
    })
}

fn format(id: u16, tymed: TYMED) -> FORMATETC {
    FORMATETC {
        cfFormat: id,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: tymed.0 as u32,
    }
}

/// An item of the descriptor, with its index in the source's list.
type Entry = (usize, Item);

#[implement(IDataObject, IDataObjectAsyncCapability)]
struct DataObject {
    shared: Arc<Shared>,
    /// What the descriptor lists, once the source said (paths too long are left out); an
    /// error is noted in `shared`.
    entries: OnceLock<std::result::Result<Vec<Entry>, ()>>,
    /// What others put in (the shell's drag image and the like), for whoever asks.
    stored: Mutex<Vec<(u16, Vec<u8>)>>,
    asynchronous: AtomicBool,
    in_operation: AtomicBool,
}

impl DataObject {
    fn entries(&self) -> Result<&[Entry]> {
        let entries = self
            .entries
            .get_or_init(|| match self.shared.source.items() {
                Ok(items) => Ok(items
                    .into_iter()
                    .enumerate()
                    .filter(|(_, item)| item.path.encode_utf16().count() <= MAX_PATH_LEN)
                    .collect()),
                Err(message) => {
                    self.shared.failed(Ended::Failed(message));
                    Err(())
                }
            });
        entries.as_deref().map_err(|()| E_FAIL.into())
    }
}

impl Drop for DataObject {
    fn drop(&mut self) {
        self.shared.released();
    }
}

impl IDataObject_Impl for DataObject_Impl {
    fn GetData(&self, format: *const FORMATETC) -> Result<STGMEDIUM> {
        // SAFETY: COM passes a valid format.
        let format = unsafe { format.as_ref() }.ok_or(E_INVALIDARG)?;
        let formats = formats();
        let takes = |tymed: TYMED| format.tymed & tymed.0 as u32 != 0;
        if format.cfFormat == formats.descriptor && takes(TYMED_HGLOBAL) {
            return global(&descriptor(self.entries()?));
        }
        if format.cfFormat == formats.contents && takes(TYMED_ISTREAM) {
            let (index, item) = file_at(self.entries()?, format.lindex).ok_or(DV_E_LINDEX)?;
            let reader = self.shared.source.open(*index).map_err(|e| {
                self.shared.failed(ended_by(&e));
                E_FAIL
            })?;
            let stream: IStream = Stream::new(reader, item, Arc::clone(&self.shared)).into();
            return Ok(STGMEDIUM {
                tymed: TYMED_ISTREAM.0 as u32,
                u: STGMEDIUM_0 {
                    pstm: ManuallyDrop::new(Some(stream)),
                },
                pUnkForRelease: ManuallyDrop::new(None),
            });
        }
        if format.cfFormat == formats.effect && takes(TYMED_HGLOBAL) {
            return global(&DROPEFFECT_COPY.0.to_ne_bytes());
        }
        if takes(TYMED_HGLOBAL) {
            if let Some((_, bytes)) = lock(&self.stored)
                .iter()
                .find(|(id, _)| *id == format.cfFormat)
            {
                return global(bytes);
            }
        }
        Err(DV_E_FORMATETC.into())
    }

    fn GetDataHere(&self, _format: *const FORMATETC, _medium: *mut STGMEDIUM) -> Result<()> {
        Err(E_NOTIMPL.into())
    }

    fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
        // SAFETY: COM passes a valid format.
        let Some(format) = (unsafe { format.as_ref() }) else {
            return E_INVALIDARG;
        };
        let formats = formats();
        let takes = |tymed: TYMED| format.tymed & tymed.0 as u32 != 0;
        let id = format.cfFormat;
        let global = id == formats.descriptor
            || id == formats.effect
            || lock(&self.stored).iter().any(|(stored, _)| *stored == id);
        if (global && takes(TYMED_HGLOBAL)) || (id == formats.contents && takes(TYMED_ISTREAM)) {
            S_OK
        } else {
            DV_E_FORMATETC
        }
    }

    fn GetCanonicalFormatEtc(
        &self,
        format: *const FORMATETC,
        canonical: *mut FORMATETC,
    ) -> HRESULT {
        // SAFETY: COM passes valid formats.
        if let (Some(format), Some(canonical)) = unsafe { (format.as_ref(), canonical.as_mut()) } {
            *canonical = *format;
            canonical.ptd = std::ptr::null_mut();
        }
        DATA_S_SAMEFORMATETC
    }

    fn SetData(
        &self,
        format: *const FORMATETC,
        medium: *const STGMEDIUM,
        release: BOOL,
    ) -> Result<()> {
        // SAFETY: COM passes a valid format and medium.
        let (Some(format), Some(medium)) = (unsafe { format.as_ref() }, unsafe { medium.as_ref() })
        else {
            return Err(E_INVALIDARG.into());
        };
        if medium.tymed != TYMED_HGLOBAL.0 as u32 {
            return Err(E_NOTIMPL.into());
        }
        // SAFETY: a medium of global memory holds a handle to it.
        let bytes = unsafe { read_global(medium.u.hGlobal) }.ok_or(E_OUTOFMEMORY)?;
        if release.as_bool() {
            // SAFETY: with `release`, the medium is this object's to free.
            unsafe { ReleaseStgMedium(std::ptr::from_ref(medium).cast_mut()) };
        }
        let mut stored = lock(&self.stored);
        stored.retain(|(id, _)| *id != format.cfFormat);
        stored.push((format.cfFormat, bytes));
        Ok(())
    }

    fn EnumFormatEtc(&self, direction: u32) -> Result<IEnumFORMATETC> {
        if direction != DATADIR_GET.0 as u32 {
            return Err(E_NOTIMPL.into());
        }
        let formats = formats();
        let mut list = vec![
            format(formats.descriptor, TYMED_HGLOBAL),
            format(formats.contents, TYMED_ISTREAM),
            format(formats.effect, TYMED_HGLOBAL),
        ];
        list.extend(
            lock(&self.stored)
                .iter()
                .map(|(id, _)| format(*id, TYMED_HGLOBAL)),
        );
        // SAFETY: the enumerator copies the formats.
        unsafe { SHCreateStdEnumFmtEtc(&list) }
    }

    fn DAdvise(&self, _: *const FORMATETC, _: u32, _: Ref<IAdviseSink>) -> Result<u32> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }

    fn DUnadvise(&self, _: u32) -> Result<()> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }

    fn EnumDAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }
}

/// Copying in the background: the target starts and ends the operation, and asks meanwhile.
impl IDataObjectAsyncCapability_Impl for DataObject_Impl {
    fn SetAsyncMode(&self, asynchronous: BOOL) -> Result<()> {
        self.asynchronous
            .store(asynchronous.as_bool(), Ordering::SeqCst);
        Ok(())
    }

    fn GetAsyncMode(&self) -> Result<BOOL> {
        Ok(self.asynchronous.load(Ordering::SeqCst).into())
    }

    fn StartOperation(&self, _: Ref<IBindCtx>) -> Result<()> {
        self.in_operation.store(true, Ordering::SeqCst);
        self.shared.started();
        Ok(())
    }

    fn InOperation(&self) -> Result<BOOL> {
        Ok(self.in_operation.load(Ordering::SeqCst).into())
    }

    fn EndOperation(&self, result: HRESULT, _: Ref<IBindCtx>, _effects: u32) -> Result<()> {
        self.in_operation.store(false, Ordering::SeqCst);
        self.shared.finish(if result.is_ok() {
            Ended::Done
        } else if result == E_ABORT || result == HRESULT::from_win32(ERROR_CANCELLED.0) {
            Ended::Cancelled
        } else {
            Ended::Failed(windows::core::Error::from(result).message())
        });
        Ok(())
    }
}

/// The file a `FileContents` request is for: by its index in the descriptor, or the only
/// file there is when the request gives none (-1).
fn file_at(entries: &[Entry], index: i32) -> Option<&Entry> {
    let found = match usize::try_from(index) {
        Ok(index) => entries.get(index),
        Err(_) => {
            let mut files = entries.iter().filter(|(_, item)| !item.folder);
            match (files.next(), files.next()) {
                (Some(only), None) => Some(only),
                _ => None,
            }
        }
    };
    found.filter(|(_, item)| !item.folder)
}

/// The `FILEGROUPDESCRIPTORW` of `entries`: their number, then a descriptor each.
fn descriptor(entries: &[Entry]) -> Vec<u8> {
    let size = std::mem::size_of::<FILEDESCRIPTORW>();
    let mut bytes = Vec::with_capacity(4 + entries.len() * size);
    bytes.extend_from_slice(&(entries.len() as u32).to_ne_bytes());
    for (_, item) in entries {
        let mut flags = FD_ATTRIBUTES.0 | FD_FILESIZE.0 | FD_PROGRESSUI.0 | FD_UNICODE.0;
        if item.modified.is_some() {
            flags |= FD_WRITESTIME.0;
        }
        let mut name = [0u16; 260];
        for (to, unit) in name.iter_mut().zip(item.path.encode_utf16()) {
            *to = unit;
        }
        let attributes = if item.folder {
            FILE_ATTRIBUTE_DIRECTORY
        } else {
            FILE_ATTRIBUTE_NORMAL
        };
        let one = FILEDESCRIPTORW {
            dwFlags: flags as u32,
            dwFileAttributes: attributes.0,
            ftLastWriteTime: item.modified.map(filetime).unwrap_or_default(),
            nFileSizeHigh: (item.size >> 32) as u32,
            nFileSizeLow: item.size as u32,
            cFileName: name,
            ..Default::default()
        };
        // SAFETY: a packed structure of plain values, read as its bytes.
        bytes.extend_from_slice(unsafe {
            std::slice::from_raw_parts((&raw const one).cast::<u8>(), size)
        });
    }
    bytes
}

/// Seconds since the Unix epoch, as a FILETIME (100 ns since 1601).
pub(crate) fn filetime(seconds: u64) -> FILETIME {
    let ticks = (seconds + 11_644_473_600) * 10_000_000;
    FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    }
}

/// A medium of global memory holding `bytes`, which the receiver frees.
fn global(bytes: &[u8]) -> Result<STGMEDIUM> {
    // SAFETY: memory allocated here, filled while it is locked, then handed over.
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))?;
        let to = GlobalLock(memory).cast::<u8>();
        if to.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err(E_OUTOFMEMORY.into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), to, bytes.len());
        let _ = GlobalUnlock(memory);
        Ok(STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: memory },
            pUnkForRelease: ManuallyDrop::new(None),
        })
    }
}

/// What global memory holds.
///
/// # Safety
/// `memory` is a handle to global memory.
unsafe fn read_global(memory: HGLOBAL) -> Option<Vec<u8>> {
    // SAFETY: as the caller says; the memory is read while it is locked.
    unsafe {
        let size = GlobalSize(memory);
        let from = GlobalLock(memory).cast::<u8>();
        if from.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(from, size).to_vec();
        let _ = GlobalUnlock(memory);
        Some(bytes)
    }
}
