var thjs = require("telehash-js");
exports.debug = thjs.debug;
exports.info = thjs.info;

var init = function(self, args)
{
  require("telehash-cs1a").install(self, args);
  if(args.cs2a) require("telehash-cs2a").install(self, args); // slow on most browsers
  require("telehash-http").install(self, args);
  require("telehash-webrtc").install(self, args);
  require("telehash-seeds").install(self, args);
  require("telehash-stream").install(self, args);
  require("telehash-telesocket").install(self, args);
}

exports.init = function(args, cbDone)
{
  if(!args) args = {};
  var self = new thjs.switch();

  install(self, args);

  function seed()
  {
    if(typeof args.seeds == "object")
    {
      Object.keys(args.seeds).map(function(hn){return args.seeds[hn]}).forEach(self.addSeed, self);
    }else{
      require("telehash-seeds").install(self, args);
    }
    
    self.online(function(err){
      cbDone(err, self);      
    });
  }

  if(typeof args.id == "object")
  {
    var err;
    if((err = self.load(args.id))) return cbDone("error loading id, "+err+": "+JSON.stringify(args.id));
    return seed();
  }

  self.make(function(err,id){
    if(err) return cbDone("error creating id, "+err);
    args.id = id;
    self.load(id);
    return seed();      
  });
}