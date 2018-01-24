/* CONSTANTS */
var ITEM_TYPES = ["content", "message"];
var MESSAGE_TYPES = ["activity", "instructions", "message", "prompt", "reflection"];

/* MODULES */
var Backbone = require("backbone");
var _ = require("underscore");
var BaseViews = require("edit_channel/views");
var Models = require("edit_channel/models");
var ImageUploader = require('edit_channel/image/views');
var UndoManager = require("backbone-undo");
require("summernote");
var dialog = require("edit_channel/utils/dialog");

var ExerciseViews = require('edit_channel/exercise_creation/views');
var RelatedViews = require('edit_channel/related/views');

/* PARSERS */
var toMarkdown = require('to-markdown');
var stringHelper = require("edit_channel/utils/string_helper");

/* STYLESHEETS */
require("stories.less");
require("../../../css/summernote.css");

/* TRANSLATIONS */
var NAMESPACE = "storyEditor";
var MESSAGES = {};

var PROMPT_MAPPING = {
    "resource":"Add instructions or description of this resource.",
    "message": "Add a message for students letting them know anything else about this resource, narration to transition between resources if they’re viewing this story independently, your additional thoughts on what they just engaged with, or anything else. ",
    "instructions": "Add directions for an activity, instructions to take notes, logistical tasks to be done in managing materials offline, or anything else on what to do after students are finished engaging with this resource",
    "reflection": "Add questions, prompts, suggestions, or areas for discussion to encourage students to reflect on what they just engaged with, whether together or individually."

}


/*********** TEXT EDITOR FOR QUESTIONS, ANSWERS, AND HINTS ***********/
var StoryEditorView = ExerciseViews.EditorView.extend({

    default_template: require("./hbtemplates/editor_default.handlebars"),
    toggle_loading: function(isLoading) {},
    activate_editor: function() {
        var self = this;
        var selector = this.cid + "_editor";
        this.$el.html(this.edit_template({selector: selector}, {
            data: this.get_intl_data()
        }));
        this.editor = new ExerciseViews.Summernote(this.$("#" + selector), this, {
            toolbar: [
                ['style', ['bold', 'italic']],
                ['insert', ['customupload', 'customformula']],
                ['controls', ['customundo', 'customredo']]
            ],
            buttons: {
                customupload: ExerciseViews.UploadImage,
                customundo: ExerciseViews.UndoButton,
                customredo: ExerciseViews.RedoButton
            },
            placeholder: PROMPT_MAPPING[this.model.get("message_type")],
            disableResizeEditor: true,
            disableDragAndDrop: true,
            shortcuts: false,
            selector: this.cid,
            callbacks: {
                onChange: _.debounce(this.save, 1),
                onPaste: this.paste_content,
                onImageUpload: this.add_image,
                onKeydown: this.process_key,
                onUndo: this.undo,
                onRedo: this.redo,
                onInit : function(){
                    $('.note-editor .note-btn').each(function() {
                        $(this).attr("data-original-title", self.get_translation($(this).data("original-title")));
                    });
                }
            }
        });
        $('.dropdown-toggle').dropdown();
        this.editing = true;
        this.render_editor();
    },
    render_default() {
        this.$el.html(this.default_template({ text: PROMPT_MAPPING[this.model.get("message_type")] }, {
            data: this.get_intl_data()
        }));
    },
});


var StoryModalView = BaseViews.BaseModalView.extend({
    template: require("./hbtemplates/story_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,

    initialize: function(options) {
        this.modal = true;
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        this.render(this.close, {channel:window.current_channel.toJSON(), selecting: this.selecting});
        new StoryDisplayListView({
            el: this.$(".modal-body"),
            modal : this,
            model:options.channel,
            selecting: this.selecting,
            onselect: this.onselect
        });
    }
});

var StoryDisplayListView = BaseViews.BaseEditableListView.extend({
    template: require("./hbtemplates/story_list.handlebars"),
    list_selector: ".story_list",
    default_item: ".default-item",
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        this.bind_edit_functions();
        var self = this;
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        this.collection = new Models.StoryCollection();
        this.collection.fetch_for_channel(this.model.id).then(function() {
            self.render();
        });
    },
    events: {
        'click #new_story_button' : 'new_story'
    },
    render: function() {
        this.$el.html(this.template({selecting: this.selecting}, {
            data: this.get_intl_data()
        }));
        this.load_content();
    },
    create_new_view:function(data){
        var newView = new StoryListItem({
            model: data,
            containing_list_view: this,
            selecting: this.selecting,
            onselect: this.onselect
        });
        this.views.push(newView);
        return newView;
    },
    new_story: function(){
        var data = {
            title: "New Story",
            channel: window.current_channel.id
        };
        var self = this;
        var story = new Models.StoryModel(data);
        story.save().then(function() {
            var newView = self.create_new_view(story);
            self.$(self.list_selector).append(newView.el);
            self.$(".default-item").css('display', 'none');
        });
    }
});

var StoryListItem = BaseViews.BaseListEditableItemView.extend({
    name: NAMESPACE,
    $trs: MESSAGES,
    tagName: "li",
    className:"story_item list-group-item row",
    template: require("./hbtemplates/story_list_item.handlebars"),
    initialize: function(options) {
        this.bind_edit_functions();
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        _.bindAll(this, 'delete_story', 'zip_content');
        this.listenTo(this.model, "sync", this.render);
        this.render();
    },
    render: function() {
        this.$el.html(this.template({
            story: this.model.toJSON(),
            channel: window.current_channel.id,
            selecting: this.selecting
        }, {
            data: this.get_intl_data()
        }));
    },
    events: {
        'click .delete_story' : 'delete_story',
        "click .zip_button": "zip_content"
    },
    delete_story: function(event){
        var self = this;
        dialog.dialog("Warning", "Are you sure you want to delete this story?", {
            "CANCEL":function(){},
            "DELETE STORY": function(){
                self.model.destroy();
            },
        }, null);
        self.cancel_actions(event);
    },
    zip_content: function() {
        var self = this;
        this.model.zip_story().then(function(collection) {
            console.log(collection)
            self.onselect(collection);
        })

    }
});


var StoryView = ExerciseViews.ExerciseView.extend({
    template: require("./hbtemplates/story_edit.handlebars"),
    list_selector:"#story_list",
    default_item:"#story_list >.default-item",
    is_changed: false,
    additem_el: "#additem",
    last_item: null,

    initialize: function(options) {
        _.bindAll(this, 'add_item', 'selected_content_item');
        this.bind_edit_functions();
        this.page_count = 1;
        this.render();
    },
    events: {
        "click #additem": "add_item",
        "click #save_story": "save_content",
        "click #zipper": "zip_content",
        "change .story_field": "set_story",
        "click #addcontentitem": "add_content_item",
        "click #addclipboarditem": "add_clipboard_item"
    },
    render: function() {
        this.$el.html(this.template({
            story: this.model.toJSON(),
            channel: window.current_channel.toJSON()
        }, {
            data: this.get_intl_data()
        }));

        var self = this;
        this.model.fetch_items().then(function(items) {
            self.collection = items;
            self.load_content(self.collection);
        });
    },
    set_story: function() {
        this.model.set("title", this.$("#story_title").val().trim());
        this.model.set("description", this.$("#story_description").val().trim());
    },
    add_item: function(item_type, message_type, text, node, is_supplementary) {
        if(!this.$(this.additem_el).hasClass('disabled')){
            this.$(this.default_item).css('display', 'none');
            this.close_all_editors();

            var newItem = new Models.StoryItemModel({
                item_type: item_type,
                message_type: message_type,
                text: text,
                // story: window.story.id,
                is_supplementary: is_supplementary,
                node_id: node && node.get("node_id")
            });

            var self = this;
            newItem.save().then(function(story_item) {
                if (node) {
                    newItem.set("contentnode", node);
                }

                self.collection.add(newItem);
                var newView = self.create_new_view(newItem);
                $("#story_list").append(newView.el);
                self.propagate_changes();
                newView.set_open();

                if (self.last_item) {
                    self.last_item.add_action("NEXT", story_item.id);
                    if (!is_supplementary) {
                        self.last_item = newView;
                    }
                }
            });
        }
    },
    add_content_item: function() {
        var rootnode = window.current_channel.get_root("main_tree");
        this.content_modal = new StoryContentModalView({
            onselect: this.selected_content_item,
            model: rootnode,
        });
    },
    add_clipboard_item: function() {
        var clipboard = window.current_user.get_clipboard();
        this.content_modal = new StoryContentModalView({
            onselect: this.selected_content_item,
            model: clipboard
        });
    },
    selected_content_item: function(model) {
        var collection = new Models.ContentNodeCollection();
        var self = this;
        collection.fetch_nodes_by_ids_complete([model.id], true).then(function(collection) {
            var model = collection.at(0);
            self.add_item("content_node", "resource", "", model);
        });

        this.content_modal.close();
    },
    create_new_view:function(model){
        var new_story_item =  new StoryItemView({
            model: model,
            containing_list_view : this,
            onchange: this.onchange,
            page_count: this.page_count++,
        });
        this.views.push(new_story_item);
        return new_story_item;
    },
    onchange: function() {
        this.is_changed = true;
    },
    zip_content: function() {

    },
    save_content: function() {
        this.collection.forEach(function(model) {
            model.set('story', window.story.id);
        });
        this.collection.save();
        this.model.save().then(function() {
            window.location = "/channels/" + window.current_channel.id + "/edit";
        });
    },
});

var StoryItemView = ExerciseViews.AssessmentItemView.extend({
    template: require("./hbtemplates/story_item_edit.handlebars"),
    closed_toolbar_template: require("./hbtemplates/toolbar_closed.handlebars"),
    open_toolbar_template: require("./hbtemplates/toolbar_open.handlebars"),
    editor_el: ".question",
    initialize: function(options) {
        _.bindAll(this, "set_toolbar_open", "toggle", "set_toolbar_closed", "commit_type_change",
                "set_undo_redo_listener", "unset_undo_redo_listener", "toggle_focus", "set_true_false",
                "toggle_undo_redo", "update_hints", "set_type", "set_open");
        this.originalData = this.model.toJSON();
        this.onchange = options.onchange;
        this.page_count = options.page_count;
        this.question = this.model.get('question');
        this.containing_list_view = options.containing_list_view;
        this.node = this.model.get("contentnode");
        this.node = this.node && (this.node.attributes) ? this.node.toJSON() : this.node;
        this.init_undo_redo();
        this.render();
        this.set_toolbar_closed();
    },
    events: {
        "click .cancel": "cancel",
        "click .delete": "delete",
        "click .toggle_story": "toggle_focus",
        "click .toggle" : "toggle",
        "click .content_item": "load_preview"
    },
    render: function() {

        this.$el.html(this.template({
            model: this.model.toJSON(),
            cid: this.cid,
            node: this.node,
            page_count: this.page_count,
            thumbnail: this.node && _.find(this.node.files, function(i) { return i.preset.thumbnail; })
        }, {
            data: this.get_intl_data()
        }));

        this.render_editor();
    },
    render_editor: function(){
        if (!this.editor_view) {
            this.editor_view = new StoryEditorView({model: this.model, edit_key: "text"});
        }
        this.$(this.editor_el).html(this.editor_view.el);
    },
    validate: function() {
        return true;
    },
    toggle_loading: function(isLoading) {},
    set_open:function(){
        this.open = true;
        this.$(".assessment_item").addClass("active");
        this.editor_view.activate_editor();
        this.$(".question").removeClass("unfocused");
        this.set_toolbar_open();
        this.set_undo_redo_listener();
    },
    add_action: function(button_text, story_item_id) {
        var actions = JSON.parse(this.model.get('actions') || "{}");
        actions[story_item_id] = button_text;
        this.model.set("actions", JSON.stringify(actions));
        console.log(this.model)
    },
    load_preview: function(event){
        var file = _.find(this.node.files, function(i) { return !i.preset.supplementary; });
        var subtitles = _.filter(this.node.files, function(i) { return i.preset.subtitle; });
        new StoryPreviewFileView({
            node: this.model,
            model: file,
            subtitles: subtitles
        });
    },
});

var StoryContentModalView = BaseViews.BaseModalView.extend({
    template: require("./hbtemplates/story_content_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,

    initialize: function(options) {
        this.modal = true;
        this.render(this.close, {channel:window.current_channel.toJSON()});
        this.onselect = options.onselect;
        new StoryRelatedView({
            el: this.$(".modal-body"),
            modal : this,
            model:this.model,
            id_name: "id",
            container: this
        });
    },
    onselect: function(model) {
        this.onselect(model);
    }
});


var StoryRelatedView = RelatedViews.RelatedView.extend({
    navigate_to_node: function(model, slideFromRight){
        if(this.relatedList){
            var placeholder = document.createElement("DIV");
            placeholder.className = "selector_placeholder";
            var new_list = new StoryRelatedList({
                model: model,
                collection: this.collection,
                container: this.container,
                related_view: this
            });
            this.$("#selector_box").append((slideFromRight)? new_list.el : placeholder);
            this.$("#selector_box").prepend((slideFromRight)? placeholder : new_list.el);

            var self = this;
            $(placeholder).animate({width: 'toggle'}, 150);
            this.relatedList.$el.animate({width: 'toggle'}, 150, function(){
                self.$el.find(".selector_placeholder").remove();
                self.relatedList.remove();
                delete self.relatedList;
                self.relatedList = new_list;
            });
        } else{
            this.relatedList = new StoryRelatedList({
                model: model,
                collection: this.collection,
                container: this.container,
                related_view: this
            });
            this.$("#selector_box").html(this.relatedList.el)
        }
    }
});


var StoryRelatedList = RelatedViews.RelatedList.extend({
    create_new_view:function(model){
        var new_view = new StoryRelatedItem({
            containing_list_view: this,
            model: model,
            container: this.container,
            collection: this.collection
        });
        this.views.push(new_view);
        return new_view;
    }
});

var StoryRelatedItem = RelatedViews.RelatedItem.extend({
    select_prerequisite:function(){
        this.container.onselect(this.model);
    }
});

var StoryPreviewFileView = BaseViews.BaseModalView.extend({
    modal: true,
    header: null,
    template: require("./hbtemplates/story_preview_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        _.bindAll(this, 'create_preview');
        this.subtitles = options.subtitles;
        this.node = options.node;
        this.render();
        _.defer(this.create_preview);
    },
    render: function() {
        this.$el.html(this.template(null, {
            data: this.get_intl_data()
        }));
        $("body").append(this.el);
        this.$("#story_preview_modal").modal({show: true});
        this.$("#story_preview_modal").on("hidden.bs.modal", this.closed_modal);
    },
    create_preview: function(){
        var previewer = require('edit_channel/preview/views');
        previewer.render_preview(this.$("#preview_window"), this.model, this.subtitles, true, this.node.get('thumbnail_encoding') && this.node.get("thumbnail_encoding").base64, this.get_intl_data());
        if(this.subtitles.length){
            this.$("#preview_window video").get(0).textTracks[0].mode = "showing";
        }
    }
});



module.exports = {
    StoryModalView:StoryModalView,
    StoryView: StoryView
}
