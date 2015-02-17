var crypto = require('crypto');
var stream = require('stream');
var jstream = require('JSONStream');
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
    var roster = {}; // by hashname

    // load more history on demand, tries to get 'back' number from every participant
    chat.history = function(back, cbDone){
      
    };

    // serve the thtp requests for this chat
    chat.base = '/chat/'+chat.id+'/';
    mesh.thtp.match(chat.base,function(req,cbRes){
      var parts = req.path.split('/');
      if(parts[3] == 'roster') return cbRes({body:chat.rosterjs});
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

  
    chat.connect = function(chan,joinid)
    {
      chat.connected[chan.hashname] = chan;
      chat.add(chan.hashname,joinid);
      chan.joined = chat.joined;
      chan.chat = chat;
      chan.wrap('message');
      return chan;
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
      if(!msg.js.type) msg.js.type = 'chat';
      if(!msg.js.id) msg.js.id = stamp();
      var packet = self.pencode(msg.js,msg.body);

      if(msg.js.type == 'chat')
      {
        chat.log[msg.js.id] = packet;
        chat.last = msg.js.id;
      }

      // deliver to anyone connected
      Object.keys(chat.connected).forEach(function(to){
        chat.connected[to].message(packet);
      });
    }
  
    chat.receive = function(from,msg)
    {
      if(msg.js.type == 'chat') chat.onMessage(from,msg);
      // TODO statuses
    }
    

    chat.sync(cbDone);
    return chat;
  }


  self.open['chat'] = function(err, packet, chan, cbChat)
  {
    if(err) return;
    cbChat();

    // ensure valid request
    var parts = (typeof packet.js.to == 'string') && packet.js.to.split('@');
    if(!parts || !parts[0] || !parts[1] || parts[0].length > 32 || !self.isHashname(parts[1])) return chan.err('invalid');

    var chat = self.chats[packet.js.to];

    log('CHAT REQUEST',packet.js,chat&&chat.id);
    
    // new invited-to chat from originator
    if(!chat)
    {
      if(!packet.js.from || parts[1] != packet.from.hashname) return chan.err('invalid');
      chat = self.chat(packet.js.to,function(err,chat){
        if(err) return chan.err('failed');
        self.onInvite(chat);
      });
    }

    // make sure allowed
    var state = chat.roster[packet.from.hashname];
    if(!state) state = chat.roster['*'];
    if(chat.originator == packet.from.hashname) state = packet.js.from;
    if(!(state == 'invited' || state == packet.js.from)) return chan.err('denied');

    // add in
    chat.connect(chan,packet.js.from);

    // check for updated roster
    if(packet.js.roster != chat.rosterHash) chat.sync();

    // reply
    var js = {from:chat.from,roster:chat.rosterHash};
    if(chat.last) js.last = chat.last;
    log('CHAT IN OUT',js);
    chan.send({js:js});
  }

  cbMesh(undefined, self);

}