// The one command that installs Claude Code if needed, signs in and connects
// Spine to it: in Terminal on a Mac or Linux, in PowerShell on Windows.
// Windows' PowerShell takes a script served as text, so its command fetches it
// straight from the repository rather than the website.
export const COMMAND = 'curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash';
export const WINDOWS_COMMAND = 'irm https://raw.githubusercontent.com/CnxLuc/spine/main/docs/connect.ps1 | iex';
