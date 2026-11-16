use std::borrow::Cow;

use byteorder::{ByteOrder, LittleEndian};
use uuid::Uuid;

use crate::{
    error::Error,
    sql_read_bytes::SqlReadBytes,
    tds::{
        time::{Date, DateTime2, DateTimeOffset, Time},
        Collation, Numeric,
    },
    ColumnData, FixedLenType,
};

pub(crate) async fn decode<R>(src: &mut R) -> crate::Result<ColumnData<'static>>
where
    R: SqlReadBytes + Unpin,
{
    let total = src.read_u32_le().await? as usize;
    if total == 0 {
        return Ok(ColumnData::String(None));
    }
    let base = src.read_u8().await?;
    let count = src.read_u8().await? as usize;
    let mut props = vec![0u8; count];
    for byte in &mut props {
        *byte = src.read_u8().await?;
    }
    let len = total
        .checked_sub(2 + count)
        .ok_or_else(|| Error::Protocol("sql_variant: invalid length".into()))?;
    if let Ok(ty) = FixedLenType::try_from(base) {
        return super::fixed_len::decode(src, &ty).await;
    }
    let scale = props.first().copied().unwrap_or(0);
    let data = match base {
        0x28 => ColumnData::Date(Some(Date::decode(src).await?)),
        0x29 => ColumnData::Time(Some(Time::decode(src, scale as usize, len).await?)),
        0x2A => ColumnData::DateTime2(Some(
            DateTime2::decode(src, scale as usize, len.saturating_sub(3)).await?,
        )),
        0x2B => ColumnData::DateTimeOffset(Some(
            DateTimeOffset::decode(src, scale as usize, len.saturating_sub(5) as u8).await?,
        )),
        _ => {
            let mut buf = vec![0u8; len];
            for byte in &mut buf {
                *byte = src.read_u8().await?;
            }
            match base {
                0x24 if len == 16 => {
                    let mut bytes: uuid::Bytes = buf.try_into().unwrap_or_default();
                    crate::tds::codec::guid::reorder_bytes(&mut bytes);
                    ColumnData::Guid(Some(Uuid::from_bytes(bytes)))
                }
                0x6A | 0x6C if len > 1 && len <= 17 => {
                    let scale = props.get(1).copied().unwrap_or(0);
                    let mut digits = [0u8; 16];
                    digits[..len - 1].copy_from_slice(&buf[1..]);
                    let value = LittleEndian::read_u128(&digits) as i128;
                    let value = if buf[0] == 0 { -value } else { value };
                    ColumnData::Numeric(Some(Numeric::new_with_scale(value, scale)))
                }
                0xE7 | 0xEF if len % 2 == 0 => {
                    let units: Vec<u16> = buf.chunks(2).map(LittleEndian::read_u16).collect();
                    ColumnData::String(Some(Cow::Owned(String::from_utf16(&units)?)))
                }
                0xA7 | 0xAF if count >= 5 => {
                    let collation = Collation::new(LittleEndian::read_u32(&props[..4]), props[4]);
                    let text = collation
                        .encoding()?
                        .decode_without_bom_handling_and_without_replacement(&buf)
                        .ok_or_else(|| Error::Encoding("invalid sequence".into()))?;
                    ColumnData::String(Some(Cow::Owned(text.into_owned())))
                }
                _ => ColumnData::Binary(Some(Cow::Owned(buf))),
            }
        }
    };
    Ok(data)
}
