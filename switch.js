var hash = require('./hash');

// default timer settings, in seconds
var timers = {
    inactiveOut: 10,
    activeOut: 200
}

// global hash of all known switches by ipp or hash
var network = {};

function getSwitch(ipp, socket)
{

}

// every seen IPP becomes a switch object that maintains itself
function Switch(ipp, socket)
{
    this.ipp = ipp;
    this.hash = new hash.Hash(ipp);
    this.id = this.hash.toString();
    this.active = false;
    this.socket = socket;
    this.tInactive = setTimeout(this.inactiveOut, timers.inactiveOut*1000);
    return this;
}
exports.Switch = Switch;


// process incoming telex from this switch
Switch.prototype.incoming = function(telex)
{
    if(validate(s, telex))
    if(this.active) this.queue.push(telex);
}

Switch.prototype.process = function(telex, callback)
{

}

// clean up
Switch.prototype.inactiveOut = function()
{

}

// handle own timer to send pings and clean up if dissappeared

// recursive find closer

function activate(s)
{
    s.active = true;
    clearTimeout(s.tInactive);
    network[s.ipp] = network[s.id] = s;
    s.queue = async.queue(s.process, 1);
    // adjust timers
}