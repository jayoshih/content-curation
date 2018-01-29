import json

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q, Case, When, Value, IntegerField, Max, Sum, F
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseNotFound
from rest_framework.renderers import JSONRenderer

from django.shortcuts import render, get_object_or_404, redirect
from contentcuration.models import Channel, Story, StoryItem, MESSAGE_TYPES, ITEM_TYPES, FileFormat, License, FormatPreset, ContentKind, Language, ContentNode
from contentcuration.serializers import StorySerializer, StoryItemSerializer, ContentNodeStorySerializer, ChannelSerializer, CurrentUserSerializer, FileFormatSerializer, LicenseSerializer, FormatPresetSerializer, ContentKindSerializer, LanguageSerializer
from contentcuration.utils.messages import get_messages
from le_utils.constants import format_presets, content_kinds, file_formats, licenses
from rest_framework.authentication import TokenAuthentication, SessionAuthentication, BasicAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import authentication_classes, permission_classes
from contentcuration.views import get_or_set_cached_constants
from contentcuration.utils.files import create_file_from_contents


@authentication_classes((TokenAuthentication, SessionAuthentication))
@permission_classes((IsAuthenticated,))
def get_stories(request, channel_id):
    if not Channel.objects.filter(id=channel_id).exists():
        return HttpResponseNotFound("Channel with id {} not found".format(channel_id))
    stories = Story.objects.filter(channel_id=channel_id)
    return HttpResponse(JSONRenderer().render(StorySerializer(stories, many=True).data))

@authentication_classes((TokenAuthentication, SessionAuthentication))
@permission_classes((IsAuthenticated,))
def get_story_items(request, story_id):
    story_items = StoryItem.objects.filter(story_id=story_id)
    return HttpResponse(JSONRenderer().render(StoryItemSerializer(story_items, many=True).data))

@authentication_classes((TokenAuthentication, SessionAuthentication))
@permission_classes((IsAuthenticated,))
def zip_story(request, story_id, parent_id):
    story = Story.objects.get(pk=story_id)
    from contentcuration.zipit import render_story
    tmp_zip_path = render_story(story)
    license = License.objects.get(license_name=licenses.PUBLIC_DOMAIN)
    parent = ContentNode.objects.get(pk=parent_id)
    max_sort_order = parent.children.aggregate(max_count=Max("sort_order"))["max_count"]
    new_node = ContentNode(
        title=story.title,
        parent_id=parent_id,
        description=story.description or "",
        kind_id=content_kinds.HTML5,
        license = license,
        sort_order = max_sort_order + 1,
    )
    new_node.save()
    contents = open(tmp_zip_path, 'rb').read()
    file_obj = create_file_from_contents(contents, ext=file_formats.HTML5, node=new_node, preset_id=format_presets.HTML5_ZIP)
    story.storage_hash = file_obj.checksum
    story.save()
    return HttpResponse(JSONRenderer().render(ContentNodeStorySerializer(new_node).data))


@login_required
@authentication_classes((SessionAuthentication, BasicAuthentication, TokenAuthentication))
@permission_classes((IsAuthenticated,))
def channel_story(request, channel_id, story_id):
    channel = Channel.objects.get(pk=channel_id)
    channel_serializer = ChannelSerializer(channel)

    story = Story.objects.get(pk=story_id)
    story_serializer = StorySerializer(story)

    fileformats = get_or_set_cached_constants(FileFormat, FileFormatSerializer)
    licenses = get_or_set_cached_constants(License, LicenseSerializer)
    formatpresets = get_or_set_cached_constants(FormatPreset, FormatPresetSerializer)
    contentkinds = get_or_set_cached_constants(ContentKind, ContentKindSerializer)
    languages = get_or_set_cached_constants(Language, LanguageSerializer)

    json_renderer = JSONRenderer()
    return render(request, 'story.html', {"allow_edit": True,
                                                "channel": json_renderer.render(channel_serializer.data),
                                                "story": json_renderer.render(story_serializer.data),
                                                "current_user": json_renderer.render(CurrentUserSerializer(request.user).data),
                                                "messages": get_messages(),
                                                "title": settings.DEFAULT_TITLE,
                                                "message_types": json.dumps(MESSAGE_TYPES),
                                                "item_types": json.dumps(ITEM_TYPES),
                                                "fileformat_list": fileformats,
                                                "license_list": licenses,
                                                "fpreset_list": formatpresets,
                                                "ckinds_list": contentkinds,
                                                "langs_list": languages,
                                                })
