// Жадный поиск, но с проверкой границ слова и наличием хотя бы одного двоеточия
const ipv6Regex = /\b([0-9a-fA-F]{1,4}|:)*:[0-9a-fA-F:]*\b/g;

const testStr = "2a0e:d602:1:217::2";
console.log("IPv6:", testStr.replace(ipv6Regex, '[$&]'));

const testStr2 = "::1";
console.log("::1:", testStr2.replace(ipv6Regex, '[$&]'));

const testStr3 = "127.0.0.1";
console.log("IPv4 (should NOT match):", testStr3.replace(ipv6Regex, '[$&]'));

const testStr4 = "some:text:here";
console.log("Text (should NOT match hex check):", testStr4.replace(ipv6Regex, '[$&]'));
