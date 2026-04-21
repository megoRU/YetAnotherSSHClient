const ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:(?!\d)\b|\b::(?:[0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4}\b|\b[0-9a-fA-F]{1,4}::\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){1,7}\b/g;

// Еще проще: захватываем всё, что похоже на IPv6, и проверяем границы.
const ipv6Regex2 = /\b(?:[0-9a-fA-F]{1,4}:|:){1,7}(?:[0-9a-fA-F]{1,4}|:)\b/g;

const testStr = "2a0e:d602:1:217::2";
console.log("IPv6 Regex2:", testStr.match(ipv6Regex2));

const testStr2 = "::1";
console.log("::1 Regex2:", testStr2.match(ipv6Regex2));

const testStr3 = "2a0e:d602:1:217::";
console.log("End :: Regex2:", testStr3.match(ipv6Regex2));
