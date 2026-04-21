const ipv6Regex = /(([0-9a-fA-F]{1,4}:){1,7}([0-9a-fA-F]{1,4}|:)|::)/g;
const testStr = "2a0e:d602:1:217::2";
console.log(testStr.replace(ipv6Regex, '[$&]'));
