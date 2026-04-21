// Более строгий вариант: цифры и буквы A-F, минимум одно двоеточие
const ipv6Regex = /\b[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){1,7}\b/g;

const testStr = "2a0e:d602:1:217::2";
console.log("IPv6:", testStr.replace(ipv6Regex, '[$&]'));

const testStr2 = "::1";
console.log("::1:", testStr2.replace(ipv6Regex, '[$&]'));

const testStr3 = "127.0.0.1";
console.log("IPv4:", testStr3.replace(ipv6Regex, '[$&]'));

const testStr4 = "2a0e:d602:1:217::";
console.log("IPv6 end :::", testStr4.replace(ipv6Regex, '[$&]'));
