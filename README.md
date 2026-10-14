# Resume LaTeX editor

A small local browser editor for drafting the resume in LaTeX and previewing the
compiled PDF. The personal resume source stays on this machine and is excluded
from Git; the generic layout is kept in [`resume-template.tex`](./resume-template.tex).

## Requirements

- Node.js 18 or newer
- MiKTeX or TeX Live, with `pdflatex` available on `PATH`
- The LaTeX packages used by the template (`fontawesome5`, `FiraMono`,
  `tgheros`, `titlesec`, `contour`, and the standard packages in the preamble)

On Windows, install MiKTeX and enable its option to install missing packages
automatically, or install the template packages through MiKTeX Console. Restart
the terminal after installing so `pdflatex` is available on `PATH`.

## Run

```powershell
npm start
```

Open <http://127.0.0.1:3000>. Edit the LaTeX in the left pane, then choose
**Save draft** or **Build preview**. A successful build appears in the right
pane and can be downloaded as a PDF. If `azreen-resume-updated.tex` does not
exist yet, the editor opens the generic starter template; saving creates the
personal source file.

`azreen-resume-updated.tex` and `.resume-preview/` are ignored by Git. Keep
personal resume details in the ignored source file, not in the tracked generic
template.