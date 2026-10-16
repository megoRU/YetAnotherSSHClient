//! The content of a dropped file as the drop target reads it: a stream over the source's
//! reader, read once, from the start to the end.

use std::ffi::c_void;
use std::io::{ErrorKind, Read};
use std::sync::{Arc, Mutex};

use windows::Win32::Foundation::{
    E_FAIL, E_NOTIMPL, ERROR_CANCELLED, S_FALSE, S_OK, STG_E_ACCESSDENIED, STG_E_INVALIDFUNCTION,
    STG_E_INVALIDPOINTER,
};
use windows::Win32::System::Com::{
    ISequentialStream_Impl, IStream, IStream_Impl, LOCKTYPE, STATFLAG, STATFLAG_NONAME, STATSTG,
    STGC, STGM_READ, STGTY_STREAM, STREAM_SEEK, STREAM_SEEK_CUR, STREAM_SEEK_END, STREAM_SEEK_SET,
};
use windows::Win32::UI::Shell::SHStrDupW;
use windows::core::{HRESULT, HSTRING, Ref, Result};
use windows_core::implement;

use crate::data::filetime;
use crate::{Ended, Item, Shared, lock};

/// What `CopyTo` moves at a time.
const COPY_CHUNK: usize = 256 * 1024;

/// How a reader's error ends the copy.
pub(crate) fn ended_by(error: &std::io::Error) -> Ended {
    if error.kind() == ErrorKind::ConnectionAborted {
        Ended::Cancelled
    } else {
        Ended::Failed(error.to_string())
    }
}

#[implement(IStream)]
pub(crate) struct Stream {
    reading: Mutex<Reading>,
    /// The file's name, for `Stat`.
    name: String,
    size: u64,
    modified: Option<u64>,
    shared: Arc<Shared>,
}

struct Reading {
    reader: Box<dyn std::io::Read + Send>,
    /// Where the reader is.
    at: u64,
    /// Where the stream was moved: reading goes on only from where the reader is, but the
    /// target may look elsewhere (its end, for its size) and come back.
    position: u64,
    /// A failure after the data before it, for the next read.
    failure: Option<HRESULT>,
}

impl Stream {
    pub(crate) fn new(reader: Box<dyn Read + Send>, item: &Item, shared: Arc<Shared>) -> Stream {
        Stream {
            reading: Mutex::new(Reading {
                reader,
                at: 0,
                position: 0,
                failure: None,
            }),
            name: item
                .path
                .rsplit('\\')
                .next()
                .unwrap_or_default()
                .to_string(),
            size: item.size,
            modified: item.modified,
            shared,
        }
    }
}

impl ISequentialStream_Impl for Stream_Impl {
    /// Fills the buffer, waiting for the reader as needed: fewer, larger calls from another
    /// process. Less than asked for means the end.
    fn Read(&self, buffer: *mut c_void, len: u32, read: *mut u32) -> HRESULT {
        if buffer.is_null() {
            return STG_E_INVALIDPOINTER;
        }
        let mut reading = lock(&self.reading);
        if let Some(failure) = reading.failure.take() {
            return failure;
        }
        if reading.position != reading.at {
            return STG_E_INVALIDFUNCTION;
        }
        // SAFETY: COM hands a buffer of `len` bytes.
        let buffer = unsafe { std::slice::from_raw_parts_mut(buffer.cast::<u8>(), len as usize) };
        let mut filled = 0;
        while filled < buffer.len() {
            match reading.reader.read(&mut buffer[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                Err(e) => {
                    let ended = ended_by(&e);
                    // What the shell's own operations end with when the user cancels them.
                    reading.failure = Some(if ended == Ended::Cancelled {
                        HRESULT::from_win32(ERROR_CANCELLED.0)
                    } else {
                        E_FAIL
                    });
                    self.shared.failed(ended);
                    break;
                }
            }
        }
        reading.at += filled as u64;
        reading.position = reading.at;
        if !read.is_null() {
            // SAFETY: COM hands a place for the count.
            unsafe { *read = filled as u32 };
        }
        if filled == 0 {
            if let Some(failure) = reading.failure.take() {
                return failure;
            }
        }
        if filled < buffer.len() { S_FALSE } else { S_OK }
    }

    fn Write(&self, _buffer: *const c_void, _len: u32, _written: *mut u32) -> HRESULT {
        STG_E_ACCESSDENIED
    }
}

impl IStream_Impl for Stream_Impl {
    fn Seek(&self, offset: i64, origin: STREAM_SEEK, position: *mut u64) -> Result<()> {
        let mut reading = lock(&self.reading);
        let from = match origin {
            STREAM_SEEK_SET => 0,
            STREAM_SEEK_CUR => reading.position,
            STREAM_SEEK_END => self.size,
            _ => return Err(STG_E_INVALIDFUNCTION.into()),
        };
        let to = from
            .checked_add_signed(offset)
            .ok_or(STG_E_INVALIDFUNCTION)?;
        reading.position = to;
        if !position.is_null() {
            // SAFETY: COM hands a place for the position.
            unsafe { *position = to };
        }
        Ok(())
    }

    fn SetSize(&self, _size: u64) -> Result<()> {
        Err(STG_E_ACCESSDENIED.into())
    }

    fn CopyTo(
        &self,
        target: Ref<IStream>,
        len: u64,
        read: *mut u64,
        written: *mut u64,
    ) -> Result<()> {
        let target = target.ok()?;
        let mut buffer = vec![0u8; COPY_CHUNK];
        let (mut total_read, mut total_written) = (0u64, 0u64);
        let mut result = Ok(());
        while total_read < len {
            let want = (len - total_read).min(COPY_CHUNK as u64) as u32;
            let mut got = 0u32;
            let status =
                ISequentialStream_Impl::Read(self, buffer.as_mut_ptr().cast(), want, &mut got);
            total_read += u64::from(got);
            if got > 0 {
                let mut put = 0u32;
                // SAFETY: writes from a live buffer of `got` bytes.
                let wrote = unsafe { target.Write(buffer.as_ptr().cast(), got, Some(&mut put)) };
                total_written += u64::from(put);
                if wrote.is_err() {
                    result = Err(wrote.into());
                    break;
                }
            }
            if status.is_err() {
                result = Err(status.into());
                break;
            }
            if status == S_FALSE {
                break;
            }
        }
        // SAFETY: COM hands places for the counts, or none.
        unsafe {
            if !read.is_null() {
                *read = total_read;
            }
            if !written.is_null() {
                *written = total_written;
            }
        }
        result
    }

    fn Commit(&self, _flags: &STGC) -> Result<()> {
        Ok(())
    }

    fn Revert(&self) -> Result<()> {
        Ok(())
    }

    fn LockRegion(&self, _offset: u64, _len: u64, _kind: &LOCKTYPE) -> Result<()> {
        Err(STG_E_INVALIDFUNCTION.into())
    }

    fn UnlockRegion(&self, _offset: u64, _len: u64, _kind: u32) -> Result<()> {
        Err(STG_E_INVALIDFUNCTION.into())
    }

    fn Stat(&self, stat: *mut STATSTG, flag: &STATFLAG) -> Result<()> {
        // SAFETY: COM hands a structure to fill.
        let stat = unsafe { stat.as_mut() }.ok_or(STG_E_INVALIDPOINTER)?;
        let time = self.modified.map(filetime).unwrap_or_default();
        *stat = STATSTG {
            r#type: STGTY_STREAM.0 as u32,
            cbSize: self.size,
            mtime: time,
            ctime: time,
            atime: time,
            grfMode: STGM_READ,
            ..Default::default()
        };
        if flag.0 & STATFLAG_NONAME.0 == 0 {
            // SAFETY: the name is copied into memory the caller frees.
            stat.pwcsName = unsafe { SHStrDupW(&HSTRING::from(self.name.as_str())) }?;
        }
        Ok(())
    }

    fn Clone(&self) -> Result<IStream> {
        Err(E_NOTIMPL.into())
    }
}
