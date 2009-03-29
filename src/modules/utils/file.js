/**
 * @fileoverview JSM library of file-system oriented helper-functions.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["GM_getUriFromFile", "getTempFile", "getWriteStream",
                        "getBinaryContents", "getContents"];


function GM_getUriFromFile(file) {
  return Components.classes["@mozilla.org/network/io-service;1"]
                   .getService(Components.interfaces.nsIIOService)
                   .newFileURI(file);
}


function getTempFile() {
  var file = Components.classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("TmpD", Components.interfaces.nsILocalFile);

  file.append("gm-temp");
  file.createUnique(
    Components.interfaces.nsILocalFile.NORMAL_FILE_TYPE,
    0640
  );

  return file;
}


function getBinaryContents(file) {
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);

  var channel = ioService.newChannelFromURI(GM_getUriFromFile(file));
  var input = channel.open();

  var bstream = Components.classes["@mozilla.org/binaryinputstream;1"]
                          .createInstance(Components.interfaces.nsIBinaryInputStream);
  bstream.setInputStream(input);

  var bytes = bstream.readBytes(bstream.available());

  return bytes;
}


function getContents(file, charset) {
  if( !charset ) {
    charset = "UTF-8"
  }
  var ioService=Components.classes["@mozilla.org/network/io-service;1"]
    .getService(Components.interfaces.nsIIOService);
  var scriptableStream=Components
    .classes["@mozilla.org/scriptableinputstream;1"]
    .getService(Components.interfaces.nsIScriptableInputStream);
  // http://lxr.mozilla.org/mozilla/source/intl/uconv/idl/nsIScriptableUConv.idl
  var unicodeConverter = Components
    .classes["@mozilla.org/intl/scriptableunicodeconverter"]
    .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
  unicodeConverter.charset = charset;

  var channel = ioService.newChannelFromURI(GM_getUriFromFile(file));
  var input=channel.open();
  scriptableStream.init(input);
  var str=scriptableStream.read(input.available());
  scriptableStream.close();
  input.close();

  try {
    return unicodeConverter.ConvertToUnicode(str);
  } catch( e ) {
    return str;
  }
}


function getWriteStream(file) {
  var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                         .createInstance(Components.interfaces.nsIFileOutputStream);

  stream.init(file, 0x02 | 0x08 | 0x20, 420, -1);

  return stream;
}
