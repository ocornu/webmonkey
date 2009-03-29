/**
 * @fileoverview JSM library of file-system oriented helper-functions.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["getUriFromFile", "getTempFile", "getWriteStream",
                        "getBinaryContent", "getTextContent"];


/*
 * File access flags
 */
const PR_RDONLY      = 0x01;    // Open for reading only
const PR_WRONLY      = 0x02;    // Open for writing only
const PR_RDWR        = 0x04;    // Open for reading and writing
const PR_CREATE_FILE = 0x08;    // File is created if it does not exist
const PR_APPEND      = 0x10;    // File pointer is set to the end of the file
const PR_TRUNCATE    = 0x20;    // File size is truncated to 0.

// Shortcuts
const Cc = Components.classes;
const Ci = Components.interfaces;


function getUriFromFile(file) {
  return Cc["@mozilla.org/network/io-service;1"]
         .getService(Ci.nsIIOService)
         .newFileURI(file);
}


function getTempFile() {
  var file = Cc["@mozilla.org/file/directory_service;1"]
             .getService(Ci.nsIProperties)
             .get("TmpD", Ci.nsILocalFile);
  file.append("gm-temp");
  file.createUnique(Ci.nsILocalFile.NORMAL_FILE_TYPE, 0640);
  return file;
}


function getBinaryContent(file) {
    var input  = Cc["@mozilla.org/network/io-service;1"]
                 .getService(Ci.nsIIOService)
                 .newChannelFromURI(getUriFromFile(file))
                 .open();
    var stream = Cc["@mozilla.org/binaryinputstream;1"]
                 .createInstance(Ci.nsIBinaryInputStream);
    stream.setInputStream(input);
    var bytes = stream.readBytes(stream.available());
    return bytes;
}


function getTextContent(file, charset) {
  // read content from file
  var input  = Cc["@mozilla.org/network/io-service;1"]
                  .getService(Ci.nsIIOService)
                  .newChannelFromURI(getUriFromFile(file))
                  .open();
  var stream = Cc["@mozilla.org/scriptableinputstream;1"]
               .getService(Ci.nsIScriptableInputStream);
  stream.init(input);
  var content = stream.read(input.available());
  stream.close();
  input.close();

  // convert to target charset
  if(!charset) charset = "UTF-8";
  // http://lxr.mozilla.org/mozilla/source/intl/uconv/idl/nsIScriptableUConv.idl
  var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                  .createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = charset;
  try {
    return converter.ConvertToUnicode(content);
  } catch(e) {
    // conversion failed, return content as-is
    return content;
  }
}


function getWriteStream(file) {
  var stream = Cc["@mozilla.org/network/file-output-stream;1"]
               .createInstance(Ci.nsIFileOutputStream);
  stream.init(file, PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE, 420, -1);
  return stream;
}
