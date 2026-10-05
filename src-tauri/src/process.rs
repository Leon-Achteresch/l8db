use std::ffi::OsStr;

pub fn std_command(program: impl AsRef<OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    tokio::process::Command::from(std_command(program))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe() -> (&'static str, &'static [&'static str]) {
        #[cfg(windows)]
        {
            (
                "powershell.exe",
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'; if ([ConsoleProbe]::GetConsoleWindow() -ne [IntPtr]::Zero) { exit 99 }; [Console]::Out.Write('background'); [Console]::Error.Write('stderr'); exit 7"#,
                ],
            )
        }
        #[cfg(not(windows))]
        {
            (
                "sh",
                &["-c", "printf background; printf stderr >&2; exit 7"],
            )
        }
    }

    fn assert_output(output: std::process::Output) {
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stdout, b"background");
        assert_eq!(output.stderr, b"stderr");
    }

    #[test]
    fn sync_command_preserves_output_and_status_without_a_windows_console() {
        let (program, args) = probe();
        assert_output(std_command(program).args(args).output().unwrap());
    }

    #[tokio::test]
    async fn async_command_preserves_output_and_status_without_a_windows_console() {
        let (program, args) = probe();
        assert_output(command(program).args(args).output().await.unwrap());
    }
}
