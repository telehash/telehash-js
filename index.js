var fs = require("fs");
var thjs = require("telehash-js");
exports.debug = thjs.debug;
exports.info = thjs.info;

function install(self, args)
{
  // crypto
  require("telehash-cs1a").install(self, args);
  require("telehash-cs2a").install(self, args);
  require("telehash-cs3a").install(self, args);

  // networking
  require("telehash-ipv4").install(self, args);
  require("telehash-ipv6").install(self, args);
  require("telehash-http").install(self, args);

  // extensions
  require("telehash-stream").install(self, args);
  require("telehash-telesocket").install(self, args);
  require("telehash-thtp").install(self, args);
  require("telehash-token").install(self, args);
}

exports.init = function(args, cbDone)
{
  if(!args) args = {};
  var self = new thjs.switch();
  if(args.bridge) self.isBridge(true);

  install(self, args);

  function seed()
  {
    require("telehash-seeds").install(self, args);
    
    self.online(function(err){
      cbDone(err, self);      
    });
  }

  if(args.id)
  {
    if(typeof args.id == "string" && fs.existsSync(args.id)) args.id = require(args.id);
    if(typeof args.id == "object")
    {
      var err;
      if((err = self.load(args.id))) return cbDone("error loading id, "+err+": "+JSON.stringify(args.id));
      seed();
      return self;
    }
  }

  self.make(function(err,id){
    if(err) return cbDone("error creating id, "+err);
    if(typeof args.id == "string") fs.writeFileSync(args.id, JSON.stringify(id, null, 4));
    args.id = id;
    self.load(id);
    seed();      
  });
  
  return self;
}

