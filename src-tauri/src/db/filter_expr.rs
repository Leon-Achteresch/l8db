#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    Text(String),
    Number(String),
    Bool(bool),
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Cmp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    And(Vec<Expr>),
    Or(Vec<Expr>),
    Not(Box<Expr>),
    Compare(String, Cmp, Literal),
    In(String, Vec<Literal>),
    Like {
        field: String,
        pattern: String,
        escape: Option<char>,
        insensitive: bool,
    },
    IsNull(String),
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Ident(String),
    Word(String),
    Str(String),
    Num(String),
    Op(&'static str),
    Open,
    Close,
    Comma,
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '"' || c == '`' || c == '[' {
            let close = if c == '[' { ']' } else { c };
            let mut value = String::new();
            i += 1;
            loop {
                match chars.get(i) {
                    None => return Err("Nicht geschlossener Bezeichner".into()),
                    Some(&ch) if ch == close => {
                        if chars.get(i + 1) == Some(&close) {
                            value.push(close);
                            i += 2;
                        } else {
                            i += 1;
                            break;
                        }
                    }
                    Some(&ch) => {
                        value.push(ch);
                        i += 1;
                    }
                }
            }
            out.push(Token::Ident(value));
        } else if c == '\'' {
            let mut value = String::new();
            i += 1;
            loop {
                match chars.get(i) {
                    None => return Err("Nicht geschlossene Zeichenkette".into()),
                    Some('\'') => {
                        if chars.get(i + 1) == Some(&'\'') {
                            value.push('\'');
                            i += 2;
                        } else {
                            i += 1;
                            break;
                        }
                    }
                    Some(&ch) => {
                        value.push(ch);
                        i += 1;
                    }
                }
            }
            out.push(Token::Str(value));
        } else if c.is_ascii_digit()
            || (c == '-' && chars.get(i + 1).is_some_and(|n| n.is_ascii_digit()))
        {
            let start = i;
            i += 1;
            while chars
                .get(i)
                .is_some_and(|n| n.is_ascii_digit() || *n == '.' || *n == 'e' || *n == 'E')
            {
                i += 1;
            }
            out.push(Token::Num(chars[start..i].iter().collect()));
        } else if c.is_alphabetic() || c == '_' || c == '@' {
            let start = i;
            while chars
                .get(i)
                .is_some_and(|n| n.is_alphanumeric() || matches!(n, '_' | '.' | '@' | '$'))
            {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if (word.eq_ignore_ascii_case("N") || word.eq_ignore_ascii_case("E"))
                && chars.get(i) == Some(&'\'')
            {
                continue;
            }
            out.push(Token::Word(word));
        } else {
            let two: String = chars[i..(i + 2).min(chars.len())].iter().collect();
            let op = match two.as_str() {
                "<>" => Some("<>"),
                "!=" => Some("<>"),
                "<=" => Some("<="),
                ">=" => Some(">="),
                "==" => Some("="),
                _ => None,
            };
            if let Some(op) = op {
                out.push(Token::Op(op));
                i += 2;
                continue;
            }
            out.push(match c {
                '=' => Token::Op("="),
                '<' => Token::Op("<"),
                '>' => Token::Op(">"),
                '(' => Token::Open,
                ')' => Token::Close,
                ',' => Token::Comma,
                other => return Err(format!("Unerwartetes Zeichen '{other}'")),
            });
            i += 1;
        }
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        token
    }

    fn keyword(&mut self, word: &str) -> bool {
        if matches!(self.peek(), Some(Token::Word(w)) if w.eq_ignore_ascii_case(word)) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, token: Token) -> Result<(), String> {
        match self.next() {
            Some(t) if t == token => Ok(()),
            _ => Err("Unerwartetes Ende des Filters".into()),
        }
    }

    fn or(&mut self) -> Result<Expr, String> {
        let mut parts = vec![self.and()?];
        while self.keyword("OR") {
            parts.push(self.and()?);
        }
        Ok(if parts.len() == 1 {
            parts.remove(0)
        } else {
            Expr::Or(parts)
        })
    }

    fn and(&mut self) -> Result<Expr, String> {
        let mut parts = vec![self.unary()?];
        while self.keyword("AND") {
            parts.push(self.unary()?);
        }
        Ok(if parts.len() == 1 {
            parts.remove(0)
        } else {
            Expr::And(parts)
        })
    }

    fn unary(&mut self) -> Result<Expr, String> {
        if self.keyword("NOT") {
            return Ok(Expr::Not(Box::new(self.unary()?)));
        }
        if self.peek() == Some(&Token::Open) {
            let save = self.pos;
            self.pos += 1;
            if let Ok(inner) = self.or() {
                if self.peek() == Some(&Token::Close) {
                    self.pos += 1;
                    return Ok(inner);
                }
            }
            self.pos = save;
        }
        self.predicate()
    }

    fn operand(&mut self) -> Result<(String, bool), String> {
        match self.next() {
            Some(Token::Ident(name)) => Ok((name, false)),
            Some(Token::Word(word))
                if matches!(
                    word.to_ascii_uppercase().as_str(),
                    "CAST" | "UPPER" | "LOWER" | "TOSTRING" | "TO_CHAR"
                ) && self.peek() == Some(&Token::Open) =>
            {
                let upper = word.to_ascii_uppercase();
                self.pos += 1;
                let (name, _) = self.operand()?;
                if upper == "CAST" {
                    if !self.keyword("AS") {
                        return Err("CAST ohne AS".into());
                    }
                    let mut depth = 0;
                    loop {
                        match self.next() {
                            Some(Token::Open) => depth += 1,
                            Some(Token::Close) if depth == 0 => break,
                            Some(Token::Close) => depth -= 1,
                            None => return Err("CAST nicht geschlossen".into()),
                            _ => {}
                        }
                    }
                } else {
                    self.expect(Token::Close)?;
                }
                Ok((name, matches!(upper.as_str(), "UPPER" | "LOWER")))
            }
            Some(Token::Word(word)) if !is_keyword(&word) => Ok((word, false)),
            _ => Err("Spaltenname erwartet".into()),
        }
    }

    fn literal(&mut self) -> Result<Literal, String> {
        match self.next() {
            Some(Token::Str(s)) => Ok(Literal::Text(s)),
            Some(Token::Num(n)) => Ok(Literal::Number(n)),
            Some(Token::Word(w)) if w.eq_ignore_ascii_case("TRUE") => Ok(Literal::Bool(true)),
            Some(Token::Word(w)) if w.eq_ignore_ascii_case("FALSE") => Ok(Literal::Bool(false)),
            Some(Token::Word(w)) if w.eq_ignore_ascii_case("NULL") => Ok(Literal::Null),
            Some(Token::Word(w))
                if w.eq_ignore_ascii_case("UPPER") || w.eq_ignore_ascii_case("LOWER") =>
            {
                self.expect(Token::Open)?;
                let inner = self.literal()?;
                self.expect(Token::Close)?;
                Ok(inner)
            }
            _ => Err("Wert erwartet".into()),
        }
    }

    fn predicate(&mut self) -> Result<Expr, String> {
        let (field, folded) = self.operand()?;
        if self.keyword("IS") {
            let negated = self.keyword("NOT");
            if !self.keyword("NULL") {
                return Err("NULL erwartet".into());
            }
            let expr = Expr::IsNull(field);
            return Ok(if negated {
                Expr::Not(Box::new(expr))
            } else {
                expr
            });
        }
        let negated = self.keyword("NOT");
        if self.keyword("IN") {
            self.expect(Token::Open)?;
            let mut values = vec![self.literal()?];
            while self.peek() == Some(&Token::Comma) {
                self.pos += 1;
                values.push(self.literal()?);
            }
            self.expect(Token::Close)?;
            let expr = Expr::In(field, values);
            return Ok(if negated {
                Expr::Not(Box::new(expr))
            } else {
                expr
            });
        }
        let like = self.keyword("LIKE");
        let ilike = !like && self.keyword("ILIKE");
        if like || ilike {
            let pattern = match self.literal()? {
                Literal::Text(t) => t,
                _ => return Err("Muster erwartet".into()),
            };
            let escape = if self.keyword("ESCAPE") {
                match self.literal()? {
                    Literal::Text(t) => t.chars().next(),
                    _ => None,
                }
            } else {
                None
            };
            let expr = Expr::Like {
                field,
                pattern,
                escape,
                insensitive: ilike || folded,
            };
            return Ok(if negated {
                Expr::Not(Box::new(expr))
            } else {
                expr
            });
        }
        if negated {
            return Err("NOT an dieser Stelle nicht unterstützt".into());
        }
        let op = match self.next() {
            Some(Token::Op(op)) => match op {
                "=" => Cmp::Eq,
                "<>" => Cmp::Ne,
                "<" => Cmp::Lt,
                "<=" => Cmp::Le,
                ">" => Cmp::Gt,
                _ => Cmp::Ge,
            },
            _ => return Err("Vergleichsoperator erwartet".into()),
        };
        Ok(Expr::Compare(field, op, self.literal()?))
    }
}

fn is_keyword(word: &str) -> bool {
    matches!(
        word.to_ascii_uppercase().as_str(),
        "AND" | "OR" | "NOT" | "IN" | "LIKE" | "ILIKE" | "IS" | "NULL" | "TRUE" | "FALSE"
    )
}

pub fn parse(input: &str) -> Result<Expr, String> {
    let tokens = tokenize(input)?;
    if tokens.is_empty() {
        return Err("Leerer Filter".into());
    }
    let mut parser = Parser { tokens, pos: 0 };
    let expr = parser.or()?;
    if parser.pos != parser.tokens.len() {
        return Err("Filter konnte nicht vollständig gelesen werden".into());
    }
    Ok(expr)
}

pub enum LikePart {
    Text(String),
    Any,
    One,
}

pub fn like_parts(pattern: &str, escape: Option<char>) -> Vec<LikePart> {
    let mut parts = Vec::new();
    let mut text = String::new();
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if Some(c) == escape {
            if let Some(next) = chars.next() {
                text.push(next);
            }
            continue;
        }
        match c {
            '%' | '_' => {
                if !text.is_empty() {
                    parts.push(LikePart::Text(std::mem::take(&mut text)));
                }
                parts.push(if c == '%' {
                    LikePart::Any
                } else {
                    LikePart::One
                });
            }
            other => text.push(other),
        }
    }
    if !text.is_empty() {
        parts.push(LikePart::Text(text));
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_builder_filters() {
        let expr = parse("\"status\" = 'active' AND (\"age\" > 21 OR \"city\" IS NULL)").unwrap();
        assert_eq!(
            expr,
            Expr::And(vec![
                Expr::Compare("status".into(), Cmp::Eq, Literal::Text("active".into())),
                Expr::Or(vec![
                    Expr::Compare("age".into(), Cmp::Gt, Literal::Number("21".into())),
                    Expr::IsNull("city".into()),
                ]),
            ])
        );
        let like = parse("CAST(\"name\" AS VARCHAR) ILIKE '%a!%b%' ESCAPE '!'").unwrap();
        assert_eq!(
            like,
            Expr::Like {
                field: "name".into(),
                pattern: "%a!%b%".into(),
                escape: Some('!'),
                insensitive: true
            }
        );
        let parts = like_parts("%a!%b%", Some('!'));
        assert!(matches!(&parts[1], LikePart::Text(t) if t == "a%b"));
        assert_eq!(
            parse("\"tag\" NOT IN ('a', 'b')").unwrap(),
            Expr::Not(Box::new(Expr::In(
                "tag".into(),
                vec![Literal::Text("a".into()), Literal::Text("b".into())]
            )))
        );
        assert_eq!(
            parse("user.name <> 'x''y'").unwrap(),
            Expr::Compare("user.name".into(), Cmp::Ne, Literal::Text("x'y".into()))
        );
    }

    #[test]
    fn rejects_lucene_syntax() {
        assert!(parse("status:active AND age:>21").is_err());
        assert!(parse("\"a\" = ").is_err());
    }
}
