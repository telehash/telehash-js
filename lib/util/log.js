//default logging functions;

module.exports = {
  error:function(){console.error.apply(console,arguments);},
  warn:function(){console.warn.apply(console,arguments);},
  debug:function(){},
  info:function(){console.log.apply(console,arguments);}
}
