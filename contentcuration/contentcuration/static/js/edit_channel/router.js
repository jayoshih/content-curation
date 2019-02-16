var _ = require("underscore");
var Backbone = require("backbone");
var State = require("./state");

import Vue from 'vue';

//var saveDispatcher = _.clone(Backbone.Events);
var URL_CHAR_LIMIT = 7;

var ChannelEditRouter  = Backbone.Router.extend({
  initialize: function(options) {
    _.bindAll(this, "navigate_channel_home", "preview_page", "edit_page", "clipboard_page", "story_page");
	},

  routes: {
		"": "navigate_channel_home",
		":channel/edit(/:topic)(/:node)": "edit_page",
		":channel/staging(/:topic)(/:node)": "staging_page",
		":channel/view(/:topic)(/:node)": "preview_page",
		":channel/clipboard(/:topic)(/:node)": "clipboard_page",
		":channel/stories/:story_id": "story_page"
  },

	navigate_channel_home: function() {
		var ChannelListPage = require("edit_channel/channel_list/views");
		var store = require("edit_channel/channel_list/store");

		new Vue({
		  el: '#channel-container',
		  store,
		  render: h => h(ChannelListPage)
		});
	},

	edit_page : function(channel, topic, node){
		var data = { "edit_mode_on" : true, "topic": topic, "node": node, "page": "edit" };
		this.open_channel(data, State.current_channel.get_root("main_tree"));
	},
	staging_page: function(channel, topic, node){
		var data = { "edit_mode_on" : true, "is_staging" : true, "topic": topic, "node": node, "page": "staging"  };
		this.open_channel(data, State.current_channel.get_root("staging_tree"));
	},
	preview_page : function(channel, topic, node){
		var data = {"topic": topic, "node": node, "page": "view"};
		this.open_channel(data, State.current_channel.get_root("main_tree"));
	},
	clipboard_page:function(channel, topic, node){
		var data = { "edit_mode_on" : true, "is_clipboard" : true, "topic": topic, "node": node, "page": "clipboard" };
		this.open_channel(true, true, false, State.current_user.get_clipboard());
	},
	open_channel: function(data, root){
    State.openChannel(data);
		data.topic = data.topic || State.current_channel.get((data.is_staging)? "staging_tree" : "main_tree").node_id;
		this.update_url(data.topic, data.node);

		var EditViews = require("edit_channel/tree_edit/views");
		var edit_page_view = new EditViews.TreeEditView({
			el: $("#main-content-area"),
			collection: State.nodeCollection,
			edit: data.edit_mode_on && !State.current_channel.get('ricecooker_version'),
			model : root,
			path: data,
			is_clipboard : data.is_clipboard || false,
			staging: State.staging
		});
		if(!window.is_staging){
			var QueueView = require("edit_channel/queue/views");
			var queue = new QueueView.Queue({
		 		el: $("#queue-area"),
		 		collection: State.nodeCollection,
		 		clipboard_root : State.current_user.get_clipboard(),
				trash_root : State.current_channel.get_root("trash_tree"),
		 	});
		}
	},
	update_url: function(topic, node, replacement){
    State.updateUrl(topic, node, replacement);
		var urlString = State.current_channel.id + "/" + State.current_page;
		urlString += (State.topic)? "/" + State.topic.substring(0, URL_CHAR_LIMIT) : "";
		urlString += (State.node) ? "/" + State.node.substring(0, URL_CHAR_LIMIT) : "";
		this.navigate(urlString, {replace: !replacement});
	},
	story_page: function(channel, story_id){
		var Models = require("edit_channel/models");
		var StoryViews = require("edit_channel/story/views");
		var story_view = new StoryViews.StoryView({
			el: $("#story-container"),
			model: new Models.StoryModel(window.story)
		});
	}
});

module.exports = new ChannelEditRouter();
