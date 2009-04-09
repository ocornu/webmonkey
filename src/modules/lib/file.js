/**
 * @fileoverview JSM file-management library.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["File"];


// Shortcuts
const Cc = Components.classes;
const Ci = Components.interfaces;
const IO = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);


/**
 * Create a new <code>File</code> instance.
 * <code>aFile</code> is used to initialize the created object.
 * @param aOrigin   Origin location.
 * @constructor
 *
 * @class The <code>File</code> class is a wrapper around
 *        <a href="https://developer.mozilla.org/En/NsIFile" class="symbol">nsIFile</a>.
 *        providing easy file management.<br>
 *        It is centered around simple actions, in particular full-content
 *        read/write.
 * @extends nsIFile
 */
function File(/**File|nsIFile*/ aOrigin) {
  /**
   * The underlying <code>nsIFile</code> object.<br>
   * Users should only use the embedded proxy methods, unless impossible.
   * @constant
   * @type nsIFile
   */
  this._nsIFile = aOrigin;
  if (aOrigin instanceof File)
    this._nsIFile = aOrigin._nsIFile.clone();
}


/*
 * File prototype
 */
File.prototype = {
  /**
   * File name on the local file-system.
   * Can be set to navigate to a descendent of the current file.
   * @type String
   * @see <a href="https://developer.mozilla.org/en/nsIFile/append" class="symbol">nsIFile.append</a>
   */
  get name() {
    return this._nsIFile.leafName;
  },
  set name(aName) {
    this._nsIFile.append(aName);
  },

  /**
   * File URI.
   * @type nsIURI
   */
  get uri() {
    return IO.newFileURI(this._nsIFile);
  },

  /**
   * Get a unique input channel to this file.<br>
   * Used internally to read file content.
   * Users should only use the <code>read*()</code> methods, unless impossible.
   * @returns {nsIChannel}
   */
  _input: function() {
    return IO.newChannelFromURI(this.uri).open();
  },

  /**
   * Get a unique output stream to this file.<br>
   * Used internally to write file content.
   * Users should only use the <code>write()</code> method, unless impossible.
   * @see   <a href="https://developer.mozilla.org/En/NsIFileOutputStream#init()">NsIFileOutputStream.init</a>
   * @param [ioFlags=File.IO.WRONLY | File.IO.CREATE_FILE | File.IO.TRUNCATE]
   *                    Input/output flags (see {@link File.IO}).
   * @param [perm=0644] Unix file permissions.
   * @returns {nsIFileOutputStream}
   */
  _output: function(/**int*/ ioFlags, /**int*/ perm) {
    if (!ioFlags)
      ioFlags = File.IO.WRONLY | File.IO.CREATE_FILE | File.IO.TRUNCATE;
    if (!perm)
      perm = 0644;
    var out = Cc["@mozilla.org/network/file-output-stream;1"]
              .createInstance(Ci.nsIFileOutputStream);
    out.init(this._nsIFile, ioFlags, perm, -1);
    return out;
  },

  /**
   * Read raw content.
   * @returns {String}   The raw content.
   */
  read: function() {
    // read content from file
    var stream = Cc["@mozilla.org/scriptableinputstream;1"]
                 .getService(Ci.nsIScriptableInputStream);
    stream.init(this._input());
    var content = stream.read(stream.available());
    stream.close();
    return content;
  },

  /**
   * Read text content.
   * @param [aCharset="UTF-8"]  The charset to use.
   * @returns {String}   The text content.
   */
  readText: function(/**String*/ aCharset) {
    var text = this.read();
    // convert to target charset
    if(!aCharset) aCharset = "UTF-8";
    // http://lxr.mozilla.org/mozilla/source/intl/uconv/idl/nsIScriptableUConv.idl
    var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                    .createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = aCharset;
    return converter.ConvertToUnicode(text);
  },

  /**
   * Read XML content.
   * @param [aCharset="UTF-8"]  The charset to convert content to.
   * @returns {nsIDOMDocument}  The XML content.
   */
  readXML: function(/**String*/ aCharset) {
    var parser = Cc["@mozilla.org/xmlextras/domparser;1"]
                 .createInstance(Ci.nsIDOMParser);
    var text = this.readText(aCharset);
    return parser.parseFromString(text, "text/xml");
  },

  /**
   * Read binary content.
   * @returns {String}   The binary content.
   */
  readBytes: function() {
    var stream = Cc["@mozilla.org/binaryinputstream;1"]
                 .createInstance(Ci.nsIBinaryInputStream);
    stream.setInputStream(this._input());
    var bytes = stream.readBytes(stream.available());
    stream.close();
    return bytes;
  },

  /**
   * Write raw content.
   * @param aData       The raw content to write.
   * @param [perm=0644] Unix file permissions.
   */
  write: function(/**String*/ aData, /**int*/ perm) {
    var out = this._output(null, perm);
    out.write(aData, aData.length);
    out.close();
  },

  /**
   * Write XML content.
   * @param aXMLData    The XML content to write.
   * @param [aCharset]  The charset to use.
   * @param [perm=0644] Unix file permissions.
   */
  writeXML: function(/**nsIDOMNode*/ aXMLData, /**String*/ aCharset,
                     /**int*/ perm) {
    var out = this._output(null, perm);
    if (!aCharset) aCharset = "UTF-8";
    Cc["@mozilla.org/xmlextras/xmlserializer;1"]
       .createInstance(Ci.nsIDOMSerializer)
       .serializeToStream(aXMLData, out, "utf-8");
    out.close();
  },

  /*
   * ============================ nsIFile interface ============================
   *
   * These are shortcut methods to their nsIFile counterparts, with added
   * sensible default values.
   */

  /**
   * Catch-all method masquerading <code>nsIFile</code> inheritance.
   * In case of error, file name and line number will show in the command line.
   */
   __noSuchMethod__: function(id, args) {
     try {
       return this._nsIFile[id].apply(this._nsIFile, args);
     } catch (e) {
       var caller = Components.stack.caller;
       dump(e.message+" ("+caller.filename+":"+caller.lineNumber+")\n");
       throw e;
     }
   },

  /**
   * Create a new file/directory.
   * @param [aType=File.FILE]
   *        File type: {@link File.FILE} or {@link File.DIRECTORY}.
   * @param [aPermissions=0644|0755]
   *        Unix permissions (default is 0644 for a file, 0755 for a directory).
   * @see <a href="https://developer.mozilla.org/en/nsIFile/create" class="symbol">nsIFile.create</a>
   */
  create: function(/**int*/ aType, /**int*/ aPermissions) {
    if (typeof aType != "number") aType = File.FILE;
    if (typeof aPermissions != "number")
      aPermissions = aType==File.DIRECTORY ? 0755 : 0644;
    this._nsIFile.create(aType, aPermissions);
  },

  /**
   * Create a new <i>unique</i> file/directory. If the chosen name already
   * exists, variations will be tried until one proves unique.
   * @param [aType=File.FILE]
   *        File type: {@link File.FILE} or {@link File.DIRECTORY}.
   * @param [aPermissions=0644|0755]
   *        Unix permissions (default is 0644 for a file, 0755 for a directory).
   * @see <a href="https://developer.mozilla.org/en/nsIFile/createUnique" class="symbol">nsIFile.createUnique</a>
   */
  createUnique: function(/**int*/ aType, /**int*/ aPermissions) {
    if (typeof aType != "number") aType = File.FILE;
    if (typeof aPermissions != "number")
      aPermissions = aType==File.DIRECTORY ? 0755 : 0644;
    this._nsIFile.createUnique(aType, aPermissions);
    return this.name;
  },

  /**
   * Remove this file/directory.
   * @param [aRecursive=false]
   *        If set to <code>true</code>, recursively remove descendents.
   * @see <a href="https://developer.mozilla.org/en/nsIFile/remove" class="symbol">nsIFile.remove</a>
   */
  remove: function(/**boolean*/ aRecursive) {
    if (typeof aRecursive != "boolean") aRecursive = false;
    this._nsIFile.remove(aRecursive);
  }

}


/*
 * ============================== static properties ============================
 */


/**
 * Directory type.
 * @type int
 * @constant
 */
File.DIRECTORY = Ci.nsIFile.DIRECTORY_TYPE;
/**
 * File type.
 * @type int
 * @constant
 */
File.FILE      = Ci.nsIFile.NORMAL_FILE_TYPE;


/**
 * @namespace I/O flags.
 * See <a href="https://developer.mozilla.org/en/PR_Open#Parameters">MDC documentation</a>.
 */
File.IO = {};
/**
 * Open for reading only.
 * @type int
 * @constant
 */
File.IO.RDONLY      = 0x01;
/**
 * Open for writing only.
 * @type int
 * @constant
 */
File.IO.WRONLY      = 0x02;
/**
 * Open for reading and writing.
 * @type int
 * @constant
 */
File.IO.RDWR        = 0x04;
/**
 * Create file if needed.
 * @type int
 * @constant
 */
File.IO.CREATE_FILE = 0x08;
/**
 * Append to end of file.
 * @type int
 * @constant
 */
File.IO.APPEND      = 0x10;
/**
 * Reset file size to zero.
 * @type int
 * @constant
 */
File.IO.TRUNCATE    = 0x20;


/*
 * ============================== factory methods ==============================
 */


/**
 * Get the current profile folder.
 * @returns {File}   The current profile folder.
 */
File.profile = function() {
  return new File(Cc["@mozilla.org/file/directory_service;1"]
                  .getService(Ci.nsIProperties)
                  .get("ProfD", Ci.nsILocalFile));
};

/**
 * Get the temporary files folder.
 * @returns {File}   Temporary folder.
 */
File.temp = function() {
  return new File(Cc["@mozilla.org/file/directory_service;1"]
                  .getService(Ci.nsIProperties)
                  .get("TmpD", Ci.nsILocalFile));
};


/*
 * ============================== static methods ==============================
 *
 * Helper functions.
 */


/**
 * Get a file's URI.
 * @param aFile   The target file.
 * @returns {nsIURI}        Its URI.
 * @deprecated  Static method deprecated in favor of the File object.
 */
File.getUri = function(/**nsIFile*/ aFile) {
  return IO.newFileURI(aFile);
}


/**
 * Create a temporary file on the local file-system.
 * @param aFileName         Temporary file name.
 * @returns {nsILocalFile}  A temporary local file.
 * @deprecated  Static method deprecated in favor of the File object.
 */
File.getTempFile = function(/**String*/ aFileName) {
  var file = Cc["@mozilla.org/file/directory_service;1"]
             .getService(Ci.nsIProperties)
             .get("TmpD", Ci.nsILocalFile);
  file.append(aFileName);
  file.createUnique(File.FILE, 0640);
  return file;
}


/**
 * Get binary file content.
 * @param aFile         The file to read from.
 * @returns {String}    The binary content of <code>aFile</code>.
 * @deprecated  Static method deprecated in favor of the File object.
 */
File.getBinaryContent = function(/**nsIFile*/ aFile) {
    var input  = IO.newChannelFromURI(File.getUri(aFile)).open();
    var stream = Cc["@mozilla.org/binaryinputstream;1"]
                 .createInstance(Ci.nsIBinaryInputStream);
    stream.setInputStream(input);
    var bytes = stream.readBytes(stream.available());
    stream.close();
    input.close();
    return bytes;
}


/**
 * Get text file content.
 * @param aFile         The file to read from.
 * @param [aCharset]    The charset to use.
 * @returns {String}    The text content of <code>file</code>.
 * @deprecated  Static method deprecated in favor of the File object.
 */
File.getTextContent = function(/**nsIFile*/ aFile, /**String*/ aCharset) {
  // read content from file
  var input  = IO.newChannelFromURI(File.getUri(aFile)).open();
  var stream = Cc["@mozilla.org/scriptableinputstream;1"]
               .getService(Ci.nsIScriptableInputStream);
  stream.init(input);
  var text = stream.read(input.available());
  stream.close();

  // convert to target charset
  if(!aCharset) aCharset = "UTF-8";
  // http://lxr.mozilla.org/mozilla/source/intl/uconv/idl/nsIScriptableUConv.idl
  var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                  .createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = aCharset;
  try {
    return converter.ConvertToUnicode(text);
  } catch(e) {
    // conversion failed, return content as-is
    return text;
  }
}


/**
 * Get an output stream to a file.
 * @param aFile     The target file.
 * @returns {nsIFileOutputStream}   An output stream to <code>file</code>.
 * @deprecated  Static method deprecated in favor of the File object.
 */
File.getWriteStream = function(/**nsIFile*/ aFile) {
  var stream = Cc["@mozilla.org/network/file-output-stream;1"]
               .createInstance(Ci.nsIFileOutputStream);
  stream.init(aFile, File.IO.WRONLY | File.IO.CREATE_FILE | File.IO.TRUNCATE,
              420, -1);
  return stream;
}
