use std::ffi::c_void;

use windows::Win32::Graphics::Gdi::{CreateBitmap, HBITMAP};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory,
    WICDecodeMetadataCacheOnDemand, WICConvertBitmapSource,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};

pub(crate) fn read_bytes_to_hbitmap(bytes: &[u8]) -> windows::core::Result<HBITMAP> {
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let stream = factory.CreateStream()?;
        stream.InitializeFromMemory(bytes)?;
        let decoder = factory.CreateDecoderFromStream(
            &stream,
            std::ptr::null(),
            WICDecodeMetadataCacheOnDemand,
        )?;
        let frame = decoder.GetFrame(0)?;
        let mut width = 0u32;
        let mut height = 0u32;
        frame.GetSize(&mut width, &mut height)?;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        if frame.GetPixelFormat()? == GUID_WICPixelFormat32bppBGRA {
            frame.CopyPixels(std::ptr::null(), width * 4, &mut pixels)?;
        } else {
            let source = WICConvertBitmapSource(&GUID_WICPixelFormat32bppBGRA, &frame)?;
            source.CopyPixels(std::ptr::null(), width * 4, &mut pixels)?;
        }
        Ok(CreateBitmap(
            width as i32,
            height as i32,
            1,
            32,
            Some(pixels.as_ptr().cast::<c_void>()),
        ))
    }
}
