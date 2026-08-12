export function defaultDayId(days, today) {
  return days.find((day) => day.due_date === today)?.id
    ?? days.find((day) => day.due_date > today)?.id
    ?? days.at(-1)?.id
    ?? null;
}
