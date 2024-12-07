import { paramError } from './errcodes';

function normalize(t: number): string {
  return `00${t}`.slice(-2);
}

function checkDate(fn: string, year: number, month: number, date: number) {
  if (typeof year !== 'number' || Number.isNaN(year) || year < 1000 || year > 9999 || year !== (year | 0)) {
    paramError(`${fn}(): invalid year ${year}`);
  }
  if (typeof month !== 'number' || Number.isNaN(month) || month < 1 || month > 12 || month !== (month | 0)) {
    paramError(`${fn}(): invalid month ${month}`);
  }
  if (typeof date !== 'number' || Number.isNaN(date) || date < 1 || date > 31 || date !== (date | 0)) {
    paramError(`${fn}(): invalid date ${date}`);
  }
}

function checkTime(fn: string, hour: number, minute: number, second: number) {
  if (typeof hour !== 'number' || Number.isNaN(hour) || hour < 0 || hour > 23 || hour !== (hour | 0)) {
    paramError(`${fn}(): invalid hour ${hour}`);
  }
  if (
    typeof minute !== 'number' ||
    Number.isNaN(minute) ||
    minute < 0 ||
    minute > 59 ||
    minute !== (minute | 0)
  ) {
    paramError(`${fn}(): invalid minute ${minute}`);
  }
  if (
    typeof second !== 'number' ||
    Number.isNaN(second) ||
    second < 0 ||
    second > 59 ||
    second !== (second | 0)
  ) {
    paramError(`${fn}(): invalid second ${second}`);
  }
}

const regexDate = /^\d{4}-\d{2}-\d{2}$/;
const regexTime = /^\d{2}:\d{2}:\d{2}$/;
const regexDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function isValidDateString(s: string): boolean {
  return regexDate.test(s);
}

export function isValidTimeString(s: string): boolean {
  return regexTime.test(s);
}

export function isValidDateTimeString(s: string): boolean {
  return regexDateTime.test(s);
}

export function utcDateStringToTimestamp(s: string): number {
  const [year, month, day] = s.split('-').map((val) => Number(val));
  return utcDateToTimestamp(year, month, day);
}

export function localeDateStringToTimestamp(s: string): number {
  const [year, month, day] = s.split('-').map((val) => Number(val));
  return localeDateToTimestamp(year, month, day);
}

export function utcDateTimeStringToTimestamp(s: string): number {
  const dt = s.split(' ');
  const [year, month, day] = dt[0].split('-').map((val) => Number(val));
  const [hour, minute, second] = (dt[1] || '00:00:00').split(':').map((val) => Number(val));
  return utcDateTimeToTimestamp(year, month, day, hour, minute, second);
}

export function localeDateTimeStringToTimestamp(s: string): number {
  const dt = s.split(' ');
  const [year, month, day] = dt[0].split('-').map((val) => Number(val));
  const [hour, minute, second] = (dt[1] || '00:00:00').split(':').map((val) => Number(val));
  return localeDateTimeToTimestamp(year, month, day, hour, minute, second);
}

export function utcDateToTimestamp(year: number, month: number, date: number): number {
  checkDate('utcDateToTimestamp', year, month, date);
  return new Date(`${year}-${normalize(month)}-${normalize(date)}T00:00:00Z`).valueOf();
}

export function localeDateToTimestamp(year: number, month: number, date: number): number {
  checkDate('localeDateToTimestamp', year, month, date);
  return new Date(`${year}-${normalize(month)}-${normalize(date)}T00:00:00`).valueOf();
}

export function utcDateTimeToTimestamp(
  year: number,
  month: number,
  date: number,
  hour: number,
  minute: number,
  second: number
): number {
  checkDate('utcDateTimeToTimestamp', year, month, date);
  checkTime('utcDateTimeToTimestamp', hour, minute, second);
  return new Date(
    `${year}-${normalize(month)}-${normalize(date)}T${normalize(hour)}:${normalize(minute)}:${normalize(
      second
    )}Z`
  ).valueOf();
}

export function localeDateTimeToTimestamp(
  year: number,
  month: number,
  date: number,
  hour: number,
  minute: number,
  second: number
): number {
  checkDate('localeDateTimeToTimestamp', year, month, date);
  checkTime('localeDateTimeToTimestamp', hour, minute, second);
  return new Date(
    `${year}-${normalize(month)}-${normalize(date)}T${normalize(hour)}:${normalize(minute)}:${normalize(
      second
    )}`
  ).valueOf();
}
