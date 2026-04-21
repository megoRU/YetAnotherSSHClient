const ipv6Regex = /\b([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}\b|\b::[0-9a-fA-F]{0,4}\b|\b[0-9a-fA-F]{0,4}::\b/g;

const testStr = "2a0e:d602:1:217::2";
console.log("Match:", testStr.match(ipv6Regex));

const testStr2 = "::1";
console.log("Match 2:", testStr2.match(ipv6Regex));
