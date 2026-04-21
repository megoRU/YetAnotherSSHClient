const ipv6Regex = /\b([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b|\b::[0-9a-fA-F]{0,4}\b|\b[0-9a-fA-F]{0,4}::\b/g;

const testStr = "2a0e:d602:1:217::2";
console.log("IPv6:", testStr.replace(ipv6Regex, '[$&]'));

const testStr2 = "::1";
console.log("::1:", testStr2.replace(ipv6Regex, '[$&]'));

const testStr3 = "2a0e:d602:1:217::";
console.log("IPv6 end :::", testStr3.replace(ipv6Regex, '[$&]'));

const testStr4 = "fe80::215:5dff:fe00:1";
console.log("Full IPv6:", testStr4.replace(ipv6Regex, '[$&]'));
