var thjs = require("telehash-js");
exports.debug = thjs.debug;
exports.info = thjs.info;

exports.init = function(args, cbDone)
{
  if(!args) args = {};
  var self = new thjs.switch();

  require("telehash-cs1a").install(self, args);
  if(args.cs2a) require("telehash-cs2a").install(self, args); // slow on most browsers
  require("telehash-http").install(self, args);
  require("telehash-webrtc").install(self, args);

  // extensions
  require("telehash-stream").install(self, args);
  require("telehash-telesocket").install(self, args);
  require("telehash-thtp").install(self, args);
  require("telehash-token").install(self, args);

  function seed()
  {
    require("telehash-seeds").install(self, args);
    
    self.online(function(err){
      cbDone(err, self);      
    });
    return self;
  }

  if(args.id)
  {
    if(typeof args.id == "string" && localStorage && localStorage.getItem(args.id)) args.id = JSON.parse(localStorage.getItem(args.id));
    if(typeof args.id == "object")
    {
      var err;
      if((err = self.load(args.id))) return cbDone("error loading id, "+err+": "+JSON.stringify(args.id));
      return seed();
    }    
  }

  self.make(function(err,id){
    if(err) return cbDone("error creating id, "+err);
    if(typeof args.id == "string" && localStorage) localStorage.setItem(args.id, JSON.stringify(id));
    args.id = id;
    self.load(id);
    return seed();      
  });
  
  return self;
}