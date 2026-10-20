// Local compatibility helpers for older Android System WebView versions.
(function () {
  'use strict';
  if (!Object.fromEntries) Object.fromEntries = function (entries) {
    var result = {};
    Array.from(entries).forEach(function (pair) {
      Object.defineProperty(result, pair[0], { value: pair[1], enumerable: true, configurable: true, writable: true });
    });
    return result;
  };
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true, writable: true,
    value: function (callback, thisArg) {
      var result = [];
      this.forEach(function (value, index, source) {
        var next = callback.call(thisArg, value, index, source);
        if (Array.isArray(next)) next.forEach(function (entry) { result.push(entry); });
        else result.push(next);
      });
      return result;
    }
  });
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (prototype) {
    if (!prototype.replaceChildren) Object.defineProperty(prototype, 'replaceChildren', {
      configurable: true, writable: true,
      value: function () {
        var children = Array.prototype.slice.call(arguments);
        while (this.firstChild) this.removeChild(this.firstChild);
        var document = this.ownerDocument || this;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          this.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
        }
      }
    });
  });
  if (!Blob.prototype.text) Object.defineProperty(Blob.prototype, 'text', {
    configurable: true, writable: true,
    value: function () {
      var blob = this;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error('文件读取失败')); };
        reader.readAsText(blob, 'UTF-8');
      });
    }
  });
})();
