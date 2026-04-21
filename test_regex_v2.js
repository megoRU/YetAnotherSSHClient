// Новый, более надежный вариант для IPv6
const ipv6Regex = /\b(?:[a-fA-F0-9]{1,4}:){1,7}(?:[a-fA-F0-9]{1,4}|:)|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?::[a-fA-F0-9]{1,4}){1,7}|::\b/g;

const testStr = "2a0e:d602:1:217::2";
const result = testStr.replace(ipv6Regex, '[$&]');
console.log(result);

const testStr2 = "::1";
console.log(testStr2.replace(ipv6Regex, '[$&]'));

const testStr3 = "2a0e:d602:1:217::";
console.log(testStr3.replace(ipv6Regex, '[$&]'));
