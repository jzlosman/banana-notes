cask "banana-notes" do
  version "0.1.0"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE_SHA256SUMS"

  url "https://github.com/jzlosman/banana-notes/releases/download/v#{version}/Banana-Notes-#{version}.dmg"
  name "Banana Notes"
  desc "A local-first floating Markdown notepad"
  homepage "https://github.com/jzlosman/banana-notes"

  depends_on macos: ">= :sonoma"

  app "Banana Notes.app"

  zap trash: [
    "~/Library/Application Support/Foldnote",
    "~/Library/Preferences/com.jzlosman.banana-notes.plist",
    "~/Library/Preferences/dev.local.foldnote.plist",
    "~/Library/Saved Application State/com.jzlosman.banana-notes.savedState",
    "~/Library/Saved Application State/dev.local.foldnote.savedState",
    "~/Library/Caches/com.jzlosman.banana-notes",
    "~/Library/Caches/dev.local.foldnote",
    "~/Library/WebKit/com.jzlosman.banana-notes",
    "~/Library/WebKit/dev.local.foldnote",
  ]
end
