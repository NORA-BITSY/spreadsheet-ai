# LaTeX court-filing template

Reusable starting point for a U.S. court filing. The layout uses letter paper,
1-inch margins, 12-point text, double spacing, page numbers, a caption block,
a signature block, and a certificate-of-service section.

## Files

- `main.tex` — copy and edit for a filing.
- `court-filing.sty` — shared layout and filing macros.

## Build

From this directory:

```bash
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

If `latexmk` is installed:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

Replace every bracketed placeholder before filing. Confirm the final document
against the court's current local rules, required forms, page limits, service
requirements, and e-filing specifications; this generic template is not legal
advice and does not guarantee compliance with any particular court.
