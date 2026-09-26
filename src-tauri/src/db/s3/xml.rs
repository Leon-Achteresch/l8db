use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Default, Clone)]
pub struct Node {
    pub name: String,
    pub text: String,
    pub children: Vec<Node>,
}

impl Node {
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }

    pub fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    pub fn text_of(&self, name: &str) -> Option<String> {
        self.child(name).map(|c| c.text.clone())
    }
}

fn local(name: &str) -> String {
    name.rsplit(':').next().unwrap_or_default().to_string()
}

pub fn parse(xml: &str) -> Result<Node, String> {
    let mut reader = Reader::from_str(xml);
    let mut stack: Vec<Node> = vec![Node::default()];
    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("Ungültige XML-Antwort: {e}"))?;
        match event {
            Event::Start(e) => stack.push(Node {
                name: local(e.name().as_ref()),
                ..Node::default()
            }),
            Event::Empty(e) => {
                let node = Node {
                    name: local(e.name().as_ref()),
                    ..Node::default()
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                }
            }
            Event::End(_) => {
                let node = stack.pop().unwrap_or_default();
                match stack.last_mut() {
                    Some(parent) => parent.children.push(node),
                    None => return Ok(node),
                }
            }
            Event::Text(t) => {
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&t.xml10_content());
                }
            }
            Event::CData(t) => {
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&t.into_inner());
                }
            }
            Event::GeneralRef(r) => {
                let raw = format!("&{};", r.xml10_content());
                let resolved = quick_xml::escape::unescape(&raw)
                    .map(|c| c.into_owned())
                    .unwrap_or(raw);
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&resolved);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut root = stack.into_iter().next().unwrap_or_default();
    Ok(if root.children.len() == 1 {
        root.children.remove(0)
    } else {
        root
    })
}

pub fn escape(text: &str) -> String {
    quick_xml::escape::escape(text).into_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_entities_and_nesting() {
        let root = super::parse(
            r#"<?xml version="1.0"?><R xmlns="x"><Contents><Key>a &amp; b</Key><ETag>&#34;abc&#34;</ETag></Contents><Contents><Key>c</Key></Contents><Empty/></R>"#,
        )
        .unwrap();
        assert_eq!(root.name, "R");
        let keys: Vec<String> = root
            .all("Contents")
            .filter_map(|c| c.text_of("Key"))
            .collect();
        assert_eq!(keys, vec!["a & b", "c"]);
        assert_eq!(
            root.child("Contents")
                .and_then(|c| c.text_of("ETag"))
                .as_deref(),
            Some("\"abc\"")
        );
        assert!(root.child("Empty").is_some());
        assert_eq!(super::escape("<a&b>"), "&lt;a&amp;b&gt;");
    }
}
