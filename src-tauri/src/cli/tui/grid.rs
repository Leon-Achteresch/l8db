use unicode_width::UnicodeWidthChar;

pub const MAX_COLUMN: usize = 48;
const GAP: usize = 2;

pub fn clean(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

pub fn width(text: &str) -> usize {
    text.chars().map(|c| c.width().unwrap_or(0)).sum()
}

pub fn fit(text: &str, width: usize) -> String {
    let mut out = String::with_capacity(width);
    let mut used = 0;
    let total = self::width(text);
    if total <= width {
        out.push_str(text);
        used = total;
    } else if width > 0 {
        for c in text.chars() {
            let wide = c.width().unwrap_or(0);
            if used + wide + 1 > width {
                break;
            }
            out.push(c);
            used += wide;
        }
        out.push('…');
        used += 1;
    }
    out.extend(std::iter::repeat_n(' ', width - used));
    out
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Move {
    Up,
    Down,
    PageUp,
    PageDown,
    Home,
    End,
    Left,
    Right,
}

#[derive(Default)]
pub struct Grid {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    widths: Vec<usize>,
    top: usize,
    left: usize,
}

impl Grid {
    pub fn new(columns: Vec<String>, rows: Vec<Vec<String>>) -> Self {
        let columns: Vec<String> = columns.iter().map(|column| clean(column)).collect();
        let widths = columns
            .iter()
            .map(|column| width(column).clamp(1, MAX_COLUMN))
            .collect();
        let mut grid = Grid {
            columns,
            widths,
            ..Grid::default()
        };
        grid.append(rows);
        grid
    }

    pub fn append(&mut self, rows: Vec<Vec<String>>) {
        for row in &rows {
            for (widest, cell) in self.widths.iter_mut().zip(row) {
                *widest = (*widest).max(width(cell).min(MAX_COLUMN));
            }
        }
        self.rows.extend(rows);
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn scroll(&mut self, step: Move, page: usize) {
        let page = page.max(1);
        let last = self.rows.len().saturating_sub(page);
        match step {
            Move::Up => self.top = self.top.saturating_sub(1),
            Move::Down => self.top = (self.top + 1).min(last),
            Move::PageUp => self.top = self.top.saturating_sub(page),
            Move::PageDown => self.top = (self.top + page).min(last),
            Move::Home => self.top = 0,
            Move::End => self.top = last,
            Move::Left => self.left = self.left.saturating_sub(1),
            Move::Right => {
                self.left = (self.left + 1).min(self.columns.len().saturating_sub(1));
            }
        }
    }

    fn line(&self, cells: &[String], width: usize) -> String {
        let mut out = String::with_capacity(width);
        let mut used = 0;
        for (cell, column) in cells.iter().zip(&self.widths).skip(self.left) {
            let room = (width - used).min(*column);
            out.push_str(&fit(cell, room));
            used += room;
            if used + GAP >= width {
                break;
            }
            out.push_str("  ");
            used += GAP;
        }
        out
    }

    pub fn header(&self, width: usize) -> String {
        self.line(&self.columns, width)
    }

    pub fn body(&self, width: usize, height: usize) -> Vec<String> {
        self.rows
            .iter()
            .skip(self.top)
            .take(height)
            .map(|row| self.line(row, width))
            .collect()
    }

    pub fn position(&self, page: usize) -> String {
        let total = self.rows.len();
        if total == 0 {
            return "0 Zeilen".into();
        }
        let last = (self.top + page.max(1)).min(total);
        let mut text = format!("Zeile {}–{last} von {total}", self.top + 1);
        if self.left > 0 {
            text.push_str(&format!(
                " · ab Spalte {} von {}",
                self.left + 1,
                self.columns.len()
            ));
        }
        text
    }
}
