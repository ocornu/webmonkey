/////////////////////////////// global variables ///////////////////////////////

var bundle = null;
window.addEventListener("load", function() {
  // init the global string bundle
  bundle = document.getElementById("gm-browser-bundle");

  // load default namespace from pref
  document.getElementById("namespace").value =
      GM_prefRoot.get("newscript_namespace", "");

  // default the includes with the current page's url
  document.getElementById("includes").value =
      window.opener.document.getElementById("content").selectedBrowser
      .contentWindow.location.href;
}, false);

////////////////////////////////// functions ///////////////////////////////////

function doInstall() {
  var source = createScriptSource();
  if (!source) return false;
  var script = Script.fromSource(source);

  var config = GM_getConfig();
  // make sure entered details will not ruin an existing file
  if (config.installIsUpdate(script)) {
    var overwrite = confirm(bundle.getString("newscript.exists"));
    if (!overwrite) return false;
  }
  config.install(script);
  // persist namespace value
  GM_prefRoot.set("newscript_namespace", script.namespace);

  // and fire up the editor!
  openInEditor(script);
  return true;
}

// assemble the XUL fields into a script template
function createScriptSource() {
  var source = ["// ==UserScript=="];

  var name = document.getElementById("name").value;
  if (name == "") {
    alert(bundle.getString("newscript.noname"));
    return false;
  }
  source.push("// @name           " + name);

  var namespace = document.getElementById("namespace").value;
  if (namespace == "") {
    alert(bundle.getString("newscript.nonamespace"));
    return false;
  }
  source.push("// @namespace      " + namespace);

  var descr = document.getElementById("descr").value;
  if (descr != "")
    source.push("// @description    " + descr);

  var includes = document.getElementById("includes").value;
  if (includes != "") {
    includes = includes.match(/.+/g);
    includes = "// @include        " + includes.join("\n// @include        ");
    source.push(includes);
  }

  var excludes = document.getElementById("excludes").value;
  if (excludes != "") {
    excludes = excludes.match(/.+/g);
    excludes = "// @exclude        " + excludes.join("\n// @exclude        ");
    source.push(excludes);
  }

  source.push("// ==/UserScript==");
  return source.join("\n");
}
