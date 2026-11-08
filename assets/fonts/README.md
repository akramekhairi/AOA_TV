# Render fonts

Bundled unchanged from the official Noto font repository:

- [Noto Sans Arabic Regular](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSansArabic)
- [Noto Sans Regular](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans)
- [Noto Sans Symbols Regular](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSansSymbols)
- [Noto Sans Symbols 2 Regular](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSansSymbols2)

Distributed unchanged under the SIL Open Font License in OFL.txt.
The server registers all faces with Pango and supplies a fontconfig fallback chain
for mixed Arabic, Latin, digits, punctuation and symbols. Docker also installs
fontconfig and caches the fonts. The asset cache hashes all font bytes, renderer
versions and rendering settings, so existing stored images cannot mask updates.
These fonts are used for server-rendered images; they do not replace the Roku keyboard.
