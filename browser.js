// export it globally in the browser
var telehash = window.telehash = require('./index');

// enable logging by default (at this stage)
telehash.log({debug:function(){console.log( Array.prototype.slice.call(arguments) );}});

console.log('telehash loaded');
