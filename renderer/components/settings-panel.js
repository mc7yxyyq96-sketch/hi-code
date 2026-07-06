export function modelPickerSection(title, rows) {
  const section = document.createElement("div");
  section.className = "picker-section";
  const head = document.createElement("div");
  head.className = "picker-title";
  head.textContent = title;
  section.appendChild(head);
  for (const row of rows) section.appendChild(row);
  return section;
}

export function pickerRow(label, subtitle, active = false) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "picker-row" + (active ? " active" : "");
  const text = document.createElement("span");
  text.className = "picker-text";
  const main = document.createElement("span");
  main.className = "picker-main";
  main.textContent = label;
  const sub = document.createElement("span");
  sub.className = "picker-sub";
  sub.textContent = subtitle || "";
  text.append(main, sub);
  const check = document.createElement("span");
  check.className = "picker-check";
  check.textContent = active ? "✓" : "";
  row.append(text, check);
  return row;
}
