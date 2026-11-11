use super::grid::{clean, Grid, Move};

pub const PAGE: usize = 100;
pub const MAX_ROWS: usize = 1000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Key {
    Char(char),
    Enter,
    Esc,
    Tab,
    Backspace,
    Up,
    Down,
    Left,
    Right,
    PageUp,
    PageDown,
    Home,
    End,
    Run,
    Interrupt,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Object {
    pub schema: String,
    pub name: String,
    pub view: bool,
}

impl Object {
    pub fn label(&self) -> String {
        if self.schema.is_empty() {
            clean(&self.name)
        } else {
            clean(&format!("{}.{}", self.schema, self.name))
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Request {
    Open(usize),
    Rows { object: Object, offset: usize },
    Columns(Object),
    Run { sql: String, answer: Option<String> },
}

#[derive(Debug, PartialEq)]
pub enum Effect {
    Request(Request),
    Cancel,
    Quit,
}

#[derive(Default)]
pub struct Banner {
    pub name: String,
    pub kind: String,
    pub production: bool,
    pub read_only: bool,
}

pub enum Response {
    Opened {
        banner: Banner,
        objects: Vec<Object>,
    },
    Rows {
        object: Object,
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
        offset: usize,
    },
    Columns {
        object: Object,
        rows: Vec<Vec<String>>,
    },
    Results {
        grid: Option<(Vec<String>, Vec<Vec<String>>)>,
        status: String,
    },
    Confirm,
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Screen {
    Connections,
    Objects,
    Table,
    Sql,
    Confirm,
}

pub struct Model {
    pub screen: Screen,
    pub has_picker: bool,
    pub banner: Banner,
    pub objects: Vec<Object>,
    pub labels: Vec<String>,
    folded: Vec<String>,
    pub filter: String,
    pub filtering: bool,
    pub cursor: usize,
    pub table: Grid,
    pub title: String,
    pub object: Option<Object>,
    pub more: bool,
    pub sql: String,
    pub editing: bool,
    pub result: Option<Grid>,
    pub answer: String,
    pub busy: Option<&'static str>,
    pub status: String,
    pub failed: bool,
}

fn step(key: Key) -> Option<Move> {
    Some(match key {
        Key::Up => Move::Up,
        Key::Down => Move::Down,
        Key::PageUp => Move::PageUp,
        Key::PageDown => Move::PageDown,
        Key::Home => Move::Home,
        Key::End => Move::End,
        Key::Left => Move::Left,
        Key::Right => Move::Right,
        _ => return None,
    })
}

impl Model {
    pub fn new(has_picker: bool) -> Self {
        Model {
            screen: Screen::Connections,
            has_picker,
            banner: Banner::default(),
            objects: Vec::new(),
            labels: Vec::new(),
            folded: Vec::new(),
            filter: String::new(),
            filtering: false,
            cursor: 0,
            table: Grid::default(),
            title: String::new(),
            object: None,
            more: false,
            sql: String::new(),
            editing: true,
            result: None,
            answer: String::new(),
            busy: None,
            status: String::new(),
            failed: false,
        }
    }

    pub fn visible(&self) -> Vec<usize> {
        let wanted = self.filter.to_lowercase();
        self.folded
            .iter()
            .enumerate()
            .filter(|(_, label)| label.contains(&wanted))
            .map(|(index, _)| index)
            .collect()
    }

    fn go(&mut self, screen: Screen) {
        self.screen = screen;
        self.status.clear();
        self.failed = false;
    }

    fn start(&mut self, label: &'static str, request: Request) -> Option<Effect> {
        self.busy = Some(label);
        self.status.clear();
        self.failed = false;
        Some(Effect::Request(request))
    }

    pub fn open(&mut self, index: usize) -> Option<Effect> {
        if self.busy.is_some() {
            return None;
        }
        self.start("Verbindet …", Request::Open(index))
    }

    pub fn key(&mut self, key: Key, page: usize) -> Option<Effect> {
        if self.busy.is_some() {
            return (key == Key::Interrupt).then(|| {
                self.status = "Abbruch …".into();
                Effect::Cancel
            });
        }
        if key == Key::Interrupt {
            return Some(Effect::Quit);
        }
        match self.screen {
            Screen::Connections => None,
            Screen::Objects => self.objects_key(key, page),
            Screen::Table => self.table_key(key, page),
            Screen::Sql => self.sql_key(key, page),
            Screen::Confirm => self.confirm_key(key),
        }
    }

    fn selected(&self) -> Option<Object> {
        let index = *self.visible().get(self.cursor)?;
        self.objects.get(index).cloned()
    }

    fn rows(&mut self) -> Option<Effect> {
        let object = self.selected()?;
        self.start("Lädt …", Request::Rows { object, offset: 0 })
    }

    fn move_cursor(&mut self, key: Key, page: usize) {
        let last = self.visible().len().saturating_sub(1);
        self.cursor = match key {
            Key::Up => self.cursor.saturating_sub(1),
            Key::Down => self.cursor + 1,
            Key::PageUp => self.cursor.saturating_sub(page),
            Key::PageDown => self.cursor + page,
            Key::Home => 0,
            Key::End => last,
            _ => self.cursor,
        }
        .min(last);
    }

    fn objects_key(&mut self, key: Key, page: usize) -> Option<Effect> {
        if self.filtering {
            match key {
                Key::Char(c) => {
                    self.filter.push(c);
                    self.cursor = 0;
                }
                Key::Backspace => {
                    self.filter.pop();
                    self.cursor = 0;
                }
                Key::Esc => {
                    self.filtering = false;
                    self.filter.clear();
                    self.cursor = 0;
                }
                Key::Enter => {
                    self.filtering = false;
                    return self.rows();
                }
                _ => self.move_cursor(key, page),
            }
            return None;
        }
        match key {
            Key::Char('/') => self.filtering = true,
            Key::Char('q') => return Some(Effect::Quit),
            Key::Char('s') => self.go(Screen::Sql),
            Key::Enter => return self.rows(),
            Key::Char('d') => {
                let object = self.selected()?;
                return self.start("Lädt …", Request::Columns(object));
            }
            Key::Esc if !self.filter.is_empty() => {
                self.filter.clear();
                self.cursor = 0;
            }
            Key::Esc if self.has_picker => self.go(Screen::Connections),
            Key::Esc => return Some(Effect::Quit),
            _ => self.move_cursor(key, page),
        }
        None
    }

    fn table_key(&mut self, key: Key, page: usize) -> Option<Effect> {
        match key {
            Key::Esc => self.go(Screen::Objects),
            Key::Char('q') => return Some(Effect::Quit),
            Key::Char('s') => self.go(Screen::Sql),
            Key::Char('m') if self.more => {
                let object = self.object.clone()?;
                let offset = self.table.len();
                return self.start("Lädt …", Request::Rows { object, offset });
            }
            Key::Char('d') => {
                let object = self.object.clone()?;
                return self.start("Lädt …", Request::Columns(object));
            }
            _ => {
                if let Some(step) = step(key) {
                    self.table.scroll(step, page);
                }
            }
        }
        None
    }

    fn sql_key(&mut self, key: Key, page: usize) -> Option<Effect> {
        if key == Key::Run {
            if self.sql.trim().is_empty() {
                return None;
            }
            let sql = self.sql.clone();
            return self.start("Abfrage läuft …", Request::Run { sql, answer: None });
        }
        if self.editing {
            match key {
                Key::Esc => self.go(Screen::Objects),
                Key::Tab if self.result.is_some() => self.editing = false,
                _ => {}
            }
            return None;
        }
        match key {
            Key::Tab | Key::Esc => self.editing = true,
            Key::Char('q') => return Some(Effect::Quit),
            _ => {
                if let (Some(step), Some(result)) = (step(key), self.result.as_mut()) {
                    result.scroll(step, page);
                }
            }
        }
        None
    }

    pub fn paste(&mut self, text: &str) {
        if self.busy.is_some() {
            return;
        }
        match self.screen {
            Screen::Confirm => self.answer.push_str(text),
            Screen::Objects if self.filtering => {
                self.filter.push_str(text);
                self.cursor = 0;
            }
            _ => {}
        }
    }

    fn confirm_key(&mut self, key: Key) -> Option<Effect> {
        match key {
            Key::Char(c) => self.answer.push(c),
            Key::Backspace => {
                self.answer.pop();
            }
            Key::Esc => {
                self.go(Screen::Sql);
                self.status = "Nicht ausgeführt.".into();
            }
            Key::Enter => {
                let sql = self.sql.clone();
                let answer = Some(std::mem::take(&mut self.answer));
                return self.start("Abfrage läuft …", Request::Run { sql, answer });
            }
            _ => {}
        }
        None
    }

    pub fn apply(&mut self, response: Response) {
        self.busy = None;
        match response {
            Response::Opened { banner, objects } => {
                self.banner = banner;
                self.labels = objects.iter().map(Object::label).collect();
                self.folded = self
                    .labels
                    .iter()
                    .map(|label| label.to_lowercase())
                    .collect();
                self.objects = objects;
                self.filter.clear();
                self.filtering = false;
                self.cursor = 0;
                self.result = None;
                self.editing = true;
                self.go(Screen::Objects);
            }
            Response::Rows {
                object,
                columns,
                rows,
                offset,
            } => {
                let fetched = rows.len();
                if offset == 0 {
                    self.table = Grid::new(columns, rows);
                    self.title = format!("{} · Zeilen", object.label());
                    self.go(Screen::Table);
                } else {
                    self.table.append(rows);
                    self.status.clear();
                }
                self.more = fetched >= PAGE && self.table.len() < MAX_ROWS;
                self.object = Some(object);
            }
            Response::Columns { object, rows } => {
                self.table = Grid::new(vec!["Spalte".into(), "Typ".into()], rows);
                self.title = format!("{} · Spalten", object.label());
                self.more = false;
                self.object = Some(object);
                self.go(Screen::Table);
            }
            Response::Results { grid, status } => {
                self.editing = grid.is_none();
                self.result = grid.map(|(columns, rows)| Grid::new(columns, rows));
                self.go(Screen::Sql);
                self.status = status;
            }
            Response::Confirm => {
                self.answer.clear();
                self.go(Screen::Confirm);
            }
            Response::Failed(message) => {
                if self.screen == Screen::Confirm {
                    self.go(Screen::Sql);
                }
                self.status = message
                    .lines()
                    .map(|line| clean(line.trim()))
                    .filter(|line| !line.is_empty())
                    .take(4)
                    .collect::<Vec<_>>()
                    .join("\n");
                self.failed = true;
            }
        }
    }
}
