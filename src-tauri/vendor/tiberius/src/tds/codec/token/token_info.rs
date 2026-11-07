use crate::SqlReadBytes;

/// An informational message (`PRINT`, `RAISERROR` with severity <= 10) sent by the server.
#[derive(Debug, Clone)]
pub struct TokenInfo {
    /// info number
    pub number: u32,
    /// error state
    pub state: u8,
    /// severity (<10: Info)
    pub class: u8,
    /// message text
    pub message: String,
    /// server name
    pub server: String,
    /// procedure name
    pub procedure: String,
    /// line number
    pub line: u32,
}

impl TokenInfo {
    pub(crate) async fn decode<R>(src: &mut R) -> crate::Result<Self>
    where
        R: SqlReadBytes + Unpin,
    {
        let _length = src.read_u16_le().await?;

        let number = src.read_u32_le().await?;
        let state = src.read_u8().await?;
        let class = src.read_u8().await?;
        let message = src.read_us_varchar().await?;
        let server = src.read_b_varchar().await?;
        let procedure = src.read_b_varchar().await?;
        let line = src.read_u32_le().await?;

        Ok(TokenInfo {
            number,
            state,
            class,
            message,
            server,
            procedure,
            line,
        })
    }
}
