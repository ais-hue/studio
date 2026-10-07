-- Block pages. A page with template 'blocks' keeps { blocks: [...] } in its content column.
-- When an old-template page is converted, its earlier template and content are kept here so it can be put back.
ALTER TABLE pages ADD COLUMN previous TEXT;
