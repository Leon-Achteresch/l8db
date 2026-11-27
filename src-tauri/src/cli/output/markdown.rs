use std::borrow::Cow;
use std::io::{self, Write};

fn push_cell(line: &mut String, text: &str) {
    let mut start = 0;
    for (index, byte) in text.bytes().enumerate() {
        let escaped = match byte {
            b'\n' if index < start => continue,
            b'\r' | b'\n' => "<br>",
            b'\\' => "&#92;",
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'|' => "\\|",
            b'*' => "\\*",
            b'_' => "\\_",
            b'`' => "\\`",
            b'[' => "\\[",
            b']' => "\\]",
            b'~' => "\\~",
            _ => continue,
        };
        line.push_str(&text[start..index]);
        line.push_str(escaped);
        start = index + 1;
        if byte == b'\r' && text.as_bytes().get(start) == Some(&b'\n') {
            start += 1;
        }
    }
    line.push_str(&text[start..]);
}

fn write_line<'a>(
    out: &mut impl Write,
    line: &mut String,
    cells: impl IntoIterator<Item = Cow<'a, str>>,
) -> io::Result<()> {
    line.clear();
    for cell in cells {
        line.push_str("| ");
        push_cell(line, &cell);
        line.push(' ');
    }
    line.push_str("|\n");
    out.write_all(line.as_bytes())
}

pub(super) fn write<'a>(
    out: &mut impl Write,
    columns: &[String],
    rows: impl IntoIterator<Item = impl IntoIterator<Item = Cow<'a, str>>>,
) -> io::Result<()> {
    if columns.is_empty() {
        return Ok(());
    }
    let mut line = String::new();
    write_line(
        out,
        &mut line,
        columns.iter().map(|s| Cow::Borrowed(s.as_str())),
    )?;
    write_line(out, &mut line, columns.iter().map(|_| Cow::Borrowed("---")))?;
    for row in rows {
        write_line(out, &mut line, row)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    struct LineSink {
        remaining: usize,
        lines: usize,
        max_bytes: usize,
    }

    impl Write for LineSink {
        fn write(&mut self, line: &[u8]) -> io::Result<usize> {
            if self.remaining == 0 {
                return Err(io::ErrorKind::BrokenPipe.into());
            }
            self.remaining -= 1;
            self.lines += 1;
            self.max_bytes = self.max_bytes.max(line.len());
            Ok(line.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn markdown_stops_consuming_rows_on_output_error() {
        let consumed = Cell::new(0);
        let rows = (0..100_000).map(|_| {
            consumed.set(consumed.get() + 1);
            [Cow::Borrowed("value")]
        });
        let mut sink = LineSink {
            remaining: 3,
            lines: 0,
            max_bytes: 0,
        };
        let error = write(&mut sink, &["v".into()], rows).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
        assert_eq!(consumed.get(), 2);
    }

    #[test]
    fn markdown_streams_large_results_with_one_reusable_line() {
        let columns = ["name".into(), "note".into(), "city".into()];
        let values = ["Meier & Co", "Zahlung | erledigt\r\nDanke", "Zürich"];
        let mut sink = LineSink {
            remaining: usize::MAX,
            lines: 0,
            max_bytes: 0,
        };
        let mut samples = Vec::new();
        for run in 0..22 {
            let rows = (0..10_000).map(|_| values.map(Cow::Borrowed));
            let started = Instant::now();
            write(&mut sink, &columns, rows).unwrap();
            if run > 0 {
                samples.push(started.elapsed());
            }
        }
        samples.sort_unstable();
        let mut line = String::new();
        write_line(&mut sink, &mut line, values.map(Cow::Borrowed)).unwrap();
        println!(
            "10k Markdown rows: median {:?}, p95 {:?}, max write {} bytes, line capacity {} bytes",
            samples[10],
            samples[19],
            sink.max_bytes,
            line.capacity()
        );
        assert_eq!(sink.lines, 22 * 10_002 + 1);
        assert!(sink.max_bytes < 128);
        assert!(line.capacity() <= 256);
        assert!(samples[10] < Duration::from_millis(75));
        assert!(samples[19] < Duration::from_millis(150));
    }
}
