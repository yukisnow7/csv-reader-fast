// Fast drop-in for csv-reader 1.0.0 (make.fun).
// Same answers as the reference, but indexOf/slice based instead of
// one character at a time. No dependencies, no state kept between calls.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Read an unquoted field starting at pos, with `initial` already in the
  // value ('' for a plain field, the quoted value for quote junk, '"' for
  // an unterminated quote). Returns {value, ended, added} where ended is
  // 0=comma, 1=line break, 2=end of text, and added counts the characters
  // kept by this unquoted stretch (not the initial value).
  function readUnquoted(initial) {
    const start = pos;
    const comma = text.indexOf(',', start);
    const lf = text.indexOf('\n', start);
    let end;
    let kind; // 0 comma, 1 LF, 2 EOF
    if (comma === -1 && lf === -1) {
      end = len;
      kind = 2;
    } else if (lf === -1 || (comma !== -1 && comma < lf)) {
      end = comma;
      kind = 0;
    } else {
      end = lf;
      kind = 1;
    }
    let seg = text.slice(start, end);
    let added;
    let value;
    if (seg.indexOf('\r') === -1) {
      added = seg.length;
      value = initial ? initial + seg : seg;
    } else if (kind === 1 && seg.charCodeAt(seg.length - 1) === 13) {
      // CRLF at the end of the segment: drop that CR, stray-CR handling
      // below applies only to the CRs inside the rest of the segment.
      const inner = seg.slice(0, -1);
      if (inner.indexOf('\r') === -1) {
        added = inner.length;
        value = initial ? initial + inner : inner;
      } else {
        let n = 0;
        for (let i = inner.indexOf('\r'); i !== -1; i = inner.indexOf('\r', i + 1)) n++;
        for (let i = 0; i < n; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        const clean = inner.replace(/\r/g, '');
        added = clean.length;
        value = initial ? initial + clean : clean;
      }
    } else {
      // Every CR in the segment is stray: one error each, all dropped.
      let n = 0;
      for (let i = seg.indexOf('\r'); i !== -1; i = seg.indexOf('\r', i + 1)) n++;
      for (let i = 0; i < n; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      const clean = seg.replace(/\r/g, '');
      added = clean.length;
      value = initial ? initial + clean : clean;
    }
    if (kind === 0) {
      pos = end + 1;
      return { value, ended: 0, added };
    }
    if (kind === 1) {
      pos = end + 1;
      line++;
      return { value, ended: 1, added };
    }
    pos = len;
    return { value, ended: 2, added };
  }

  // Read a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let search = pos + 1;
    for (;;) {
      const q = text.indexOf('"', search);
      if (q === -1) {
        // Never closes: the quote is literal, re-read as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      const doubled = q + 1 < len && text.charCodeAt(q + 1) === 34;
      const seg = text.slice(search, q);
      if (seg.length !== 0) {
        if (seg.indexOf('\r') === -1) {
          const lfIdx = seg.indexOf('\n');
          if (lfIdx !== -1) {
            let n = 0;
            for (let i = lfIdx; i !== -1; i = seg.indexOf('\n', i + 1)) n++;
            line += n;
          }
          value = value ? value + seg : seg;
        } else {
          // CRLF and lone CR inside quotes each become one LF.
          const clean = seg.replace(/\r\n?/g, '\n');
          let n = 0;
          for (let i = clean.indexOf('\n'); i !== -1; i = clean.indexOf('\n', i + 1)) n++;
          line += n;
          value = value ? value + clean : clean;
        }
      }
      if (doubled) {
        value += '"';
        search = q + 2;
        continue;
      }
      // Closing quote.
      pos = q + 1;
      if (pos >= len) return { value, ended: 2, added: 0 };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        return { value, ended: 0, added: 0 };
      }
      if (c === 10) {
        pos++;
        line++;
        return { value, ended: 1, added: 0 };
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        return { value, ended: 1, added: 0 };
      }
      // Junk after the closing quote, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
