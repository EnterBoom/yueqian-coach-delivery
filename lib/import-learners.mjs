function comparable(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseLearnerRows(text, selectedGroupId, groups) {
  const selectedGroup = selectedGroupId
    ? groups.find((group) => Number(group.id) === Number(selectedGroupId))
    : null;
  if (selectedGroupId && !selectedGroup) throw new Error("请选择有效的小组");

  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 300)
    .map((line) => {
      const parts = line.split(/[\t,，]/).map((part) => part.trim());
      const name = parts[0];
      let group = selectedGroup;
      let noteParts = parts.slice(1);

      if (selectedGroup) {
        if (comparable(parts[1]) === comparable(selectedGroup.name)) noteParts = parts.slice(2);
      } else {
        group = groups.find((item) => comparable(item.name) === comparable(parts[1]));
        noteParts = parts.slice(2);
      }

      if (!name || !group) throw new Error(`无法识别学员行：${line}`);
      return { name: name.slice(0, 80), groupId: Number(group.id), note: noteParts.join("，").slice(0, 500) };
    });
}
