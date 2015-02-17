var crypto = require('crypto');
var stream = require('stream');
var es = require('event-stream');

// implements https://github.com/telehash/telehash.org/blob/master/v3/channels/chat.md
exports.name = 'chat';

exports.mesh = function(mesh, cbMesh)
{
  var lib = mesh.lib;
  var self = {open:{}, chats:{}};

  // overwrite-able callback for invites
  var invited = function(chat){};
  mesh.invited = function(handler){ invited = handler; };
  
  // create/join a new chat
  mesh.chat = function(args, cbReady)
  {
    if(typeof args != 'object') return cbReady('bad args');

    // generate or load basics for the unique chat id
    var chat = {};
    chat.secret = args.secret || crypto.randomBytes(8);
    chat.depth = args.depth || 1000;
    chat.seq = args.seq || chat.depth;
    chat.id = args.id || stamp();
    self.chats[chat.id] = chat;

    chat.leader = args.leader || mesh;
    chat.messages = {}; // index of all cached chat messages "id":{...}
    chat.log = []; // ordered combined history ["id","id"]
    chat.roster = {}; // joins by hashname
    chat.joined = false;
    chat.inbox = new stream.Readable();
    chat.outbox = new stream.Writeable();
    
    // in scope only
    var connected = {}; // by hashname

    // load more history on demand, tries to get 'back' number from every participant
    chat.history = function(back, cbDone){
      
    };

    // serve the thtp requests for this chat
    chat.base = '/chat/'+chat.id+'/';
    mesh.thtp.match(chat.base,function(req,cbRes){
      var parts = req.path.split('/');
      if(parts[3] == 'roster') return cbRes({body:chat.roster});
      if(parts[3] == 'id' && chat.log[parts[4]]) return cbRes({body:self.pencode(chat.log[parts[4]])});
      cbRes({status:404,body:'not found'});
    });

    function fail(err)
    {
      if(!err) return; // only catch errors
      chat.err = err;
      // TODO error inbox/outbox
    }

    // internal message id generator
    function stamp()
    {
      if(!chat.seq) return fail('chat history overflow, please restart');
      var id = lib.sip.hash(mesh.hashname, chat.secret);
      for(var i = 0; i < chat.seq; i++) id = lib.sip.hash(id.key,id);
      chat.seq--;
      return lib.base32.encode(id);
    }

    chat.join = function(join, cbDone)
    {
      chat.seq = chat.depth;
      chat.joined = join;
      join.json.type = 'join';
      join.json.id = (chat.leader == mesh) ? chat.id : stamp();
      chat.last = join.json.id;
      join.json.at = Math.floor(Date.now()/1000);
      if(chat.log[0]) join.json.after = chat.log[0].id;
      chat.add(mesh.hashname,chat.join.from);

      chat.sync(cbDone);
    }

    chat.sync = function(cbDone)
    {
      // after roster is sync'd, check each participant
      function done()
      {
        Object.keys(chat.roster).forEach(function(hn){
          if(hn == mesh.hashname) return;
          if(chat.roster[hn].rhash != chat.rhash) chat.roster[hn].sync();
        });
        if(cbDone) cbDone();
      }

      // we are the leader, make sure others are in sync
      if(chat.leader == mesh)
      {
        // generate current hash
        var roster = {};
        Object.keys(chat.roster).forEach(function(hn){
          roster[hn] = chat.roster[hn].id;
        });
        chat.rhash = lib.sip.hash(mesh.hashname, JSON.stringify(roster));

        return done();
      }

      // non-leaders always fetch updated roster to sync
      chat.leader.request(chat.base+'roster', fail).pipe(es.wait(function(err, body){
        if(err) return fail(err);
        try{
          var roster = JSON.parse(body)
        }catch(E){
          return fail(E);
        }
        // update the hash to detect changes
        chat.rhash = lib.sip.hash(chat.leader.hashname, body);
        
        // sync the roster to the leader's version, drops any missing
        var existing = chat.roster;
        chat.roster = {};
        Object.keys(roster).forEach(function(hn){
          // join ids must match or it starts over
          if(existing[hn] && existing[hn].id == roster[hn])
          {
            chat.roster[hn] = existing[hn];
          }else{
            // add and sync immediately
            chat.add(hn,roster[hn]).sync();
          }
        });
      }));
    }

    chat.add = function(hashname, join){
      join = join||'*';
      if(chat.roster[hashname] == join) return;
      var part = chat.roster[hashname];
      
      // add new participant state
      if(!part) part = chat.roster[hashname] = {
        sync: function(){
          if(part.rhash == chat.rhash) return; // in sync
          if(chat.connected[hn] && chat.connected[hn].joined == chat.joined) return;
          log('CHAT OUT',js);
          chat.connecting[hn] = true;
          self.start(hn,'chat',{bare:true,js:js},function(err,packet,chan,cbChat){
            delete chat.connecting[hn];
            if(err) return error(err);
            log('CHAT IN',packet.js);
            chat.connect(chan,packet.js.from);
            cbChat();
          });
        }
      };
      var part = chat.roster[hashname];
      part.join = join;
      
      // support remove if leader
      if(chat.leader == mesh && join == '')

      // update roster hash
      if(id) chat.roster[hashname] = id;
      else delete chat.roster[hashname];
      chat.rosterHash = mhash(Object.keys(chat.roster).sort().map(function(key){ return key+chat.roster[key]; }).join('')).toString('hex');

      if(!id) return setJoin(hashname,{js:{text:'removed'}});

      // not an actual message yet
      if(id.indexOf(',') == -1) return setJoin(hashname,{js:{text:id}});
    
      // already have it
      if(chat.joins[hashname] && chat.joins[hashname].js.id == id) return setJoin(hashname,chat.joins[hashname]);

      // fetch join message from originator unless it's us
      var errd;
      var to = (chat.originator != self.hashname) ? chat.originator : hashname;
      self.thtp.request({hashname:to,path:chat.base+'id/'+id},function(err){
        if(!err) return;
        setJoin(hashname,{js:{text:err}});
        errd = true;
      }).pipe(es.join()).pipe(es.map(function(packet){
        if(errd) return;
        var msg = self.pdecode(packet);
        if(!msg) return setJoin(hashname,{js:{text:'bad join'}});
        setJoin(hashname,msg);
      }));
    }

    chat.send = function(msg)
    {
      if(!msg.json.type) msg.json.type = 'chat';
      if(!msg.json.id) msg.json.id = stamp();
      var packet = mesh.lib.lob.packet(msg.json,msg.body);

      if(msg.json.type == 'chat')
      {
        chat.log[msg.json.id] = packet;
        chat.last = msg.json.id;
      }

      // deliver to anyone connected
      Object.keys(chat.connected).forEach(function(to){
        chat.connected[to].write(packet);
      });
    }
  
    chat.sync(cbDone);
    return chat;
  }


  self.open.chat = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = mesh.lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // process invites
    var chat = self.chats[open.json.chat];
    if(!chat)
    {
      if(open.json.chat != open.json.join) return cbOpen('unknown chat');
      if(!mesh.invited) return cbOpen('cannot accept invites');
      // create to load roster then call invited
      mesh.chat({leader:link,id:open.json.chat},function(err, chat){
        if(err) return cbOpen(err);
        chat.invited = open;
        mesh.invited(chat);
      });
      return;
    }

    log('CHAT REQUEST',open.json,chat);

    // is sender in the roster?
    // TODO respond, make channel, add connected

  }

  cbMesh(undefined, self);

}