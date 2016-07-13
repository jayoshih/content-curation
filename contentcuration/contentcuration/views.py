import copy
import json
import logging
import os
import urlparse
from rest_framework import status
from django.core.mail import send_mail
from django.http import Http404, HttpResponse, HttpResponseBadRequest, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from django.views.generic.edit import FormView
from django.shortcuts import render, get_object_or_404, redirect, render_to_response
from django.contrib.sites.shortcuts import get_current_site
from django.contrib.auth import authenticate, login
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.core import paginator
from django.core.management import call_command
from django.core.exceptions import ObjectDoesNotExist
from django.core.files.storage import get_storage_class
from django.core.context_processors import csrf
from django.db.models import Q
from django.template import RequestContext
from django.template.loader import render_to_string
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from contentcuration.models import Exercise, AssessmentItem, Channel, License, FileFormat, File, FormatPreset, ContentKind, ContentNode, ContentTag, User, Invitation
from contentcuration.serializers import ExerciseSerializer, AssessmentItemSerializer, ChannelSerializer, LicenseSerializer, FileFormatSerializer, FormatPresetSerializer, ContentKindSerializer, ContentNodeSerializer, TagSerializer, UserSerializer
from contentcuration.forms import InvitationForm, InvitationAcceptForm, RegistrationForm
from registration.backends.hmac.views import RegistrationView

def base(request):
    return redirect('channels')    # redirect to the channel list page


def testpage(request):
    return render(request, 'test.html')

@login_required
def channel_list(request):
    channel_list = Channel.objects.filter(deleted=False, editors__email__contains= request.user)
    channel_serializer = ChannelSerializer(channel_list, many=True)

    licenses = License.objects.all()
    license_serializer = LicenseSerializer(licenses, many=True)
    return render(request, 'channel_list.html', {"channels" : JSONRenderer().render(channel_serializer.data),
                                                 "license_list" : JSONRenderer().render(license_serializer.data),
                                                 "current_user" : JSONRenderer().render(UserSerializer(request.user).data)})
@login_required
def channel(request, channel_id):
    channel = get_object_or_404(Channel, id=channel_id, deleted=False)
    channel_serializer =  ChannelSerializer(channel)

    channel_list = Channel.objects.filter(deleted=False, editors__email__contains= request.user)
    channel_list_serializer = ChannelSerializer(channel_list, many=True)

    accessible_channel_list = Channel.objects.filter( Q(deleted=False, public=True) | Q(deleted=False, editors__email__contains= request.user))
    accessible_channel_list_serializer = ChannelSerializer(accessible_channel_list, many=True)

    fileformats = FileFormat.objects.all()
    fileformat_serializer = FileFormatSerializer(fileformats, many=True)

    licenses = License.objects.all()
    license_serializer = LicenseSerializer(licenses, many=True)

    formatpresets = FormatPreset.objects.all()
    formatpreset_serializer = FormatPresetSerializer(formatpresets, many=True)

    contentkinds = ContentKind.objects.all()
    contentkind_serializer = ContentKindSerializer(contentkinds, many=True)

    channel_tags = ContentTag.objects.all()
    channel_tags_serializer = TagSerializer(channel_tags, many=True)

    return render(request, 'channel_edit.html', {"channel" : JSONRenderer().render(channel_serializer.data),
                                                "accessible_channels" : JSONRenderer().render(accessible_channel_list_serializer.data),
                                                "channels" : JSONRenderer().render(channel_list_serializer.data),
                                                "fileformat_list" : JSONRenderer().render(fileformat_serializer.data),
                                                 "license_list" : JSONRenderer().render(license_serializer.data),
                                                 "fpreset_list" : JSONRenderer().render(formatpreset_serializer.data),
                                                 "ckinds_list" : JSONRenderer().render(contentkind_serializer.data),
                                                 "ctags": JSONRenderer().render(channel_tags_serializer.data),
                                                 "current_user" : JSONRenderer().render(UserSerializer(request.user).data)})

def exercise_list(request):

    exercise_list = Exercise.objects.all().order_by('title')

    paged_list = paginator.Paginator(exercise_list, 25)  # Show 25 exercises per page

    page = request.GET.get('page')

    try:
        exercises = paged_list.page(page)
    except paginator.PageNotAnInteger:
        # If page is not an integer, deliver first page.
        exercises = paged_list.page(1)
    except paginator.EmptyPage:
        # If page is out of range (e.g. 9999), deliver last page of results.
        exercises = paged_list.page(paginator.num_pages)

    serializer = ExerciseSerializer(exercises.object_list, many=True)

    return render(request, 'exercise_list.html', {"exercises": exercises, "blob": JSONRenderer().render(serializer.data)})


def exercise(request, exercise_id):

    exercise = get_object_or_404(Exercise, id=exercise_id)

    serializer = ExerciseSerializer(exercise)

    assessment_items = AssessmentItem.objects.filter(exercise=exercise)

    assessment_serialize = AssessmentItemSerializer(assessment_items, many=True)

    return render(request, 'exercise_edit.html', {"exercise": JSONRenderer().render(serializer.data), "assessment_items": JSONRenderer().render(assessment_serialize.data)})


# TODO-BLOCKER: remove this csrf_exempt! People might upload random stuff here and we don't want that.
@csrf_exempt
def file_upload(request):

    if request.method == 'POST':
        ext = os.path.splitext(request.FILES.values()[0]._name)[1].split(".")[-1]
        original_filename = request.FILES.values()[0]._name
        file_object = File(file_on_disk=request.FILES.values()[0], file_format=FileFormat.objects.get(extension=ext), original_filename = original_filename)
        file_object.save()
        return HttpResponse(json.dumps({
            "success": True,
            "filename": str(file_object),
            "object_id": file_object.pk
        }))

@csrf_exempt
def thumbnail_upload(request):
    if request.method == 'POST':
        return HttpResponse(json.dumps({
            "success": True
        }))

def duplicate_nodes(request):
    logging.debug("Entering the copy_node endpoint")

    if request.method != 'POST':
        raise HttpResponseBadRequest("Only POST requests are allowed on this endpoint.")
    else:
        data = json.loads(request.body)

        try:
            node_ids = data["node_ids"]
            sort_order = data["sort_order"]
            target_parent = data["target_parent"]
        except KeyError:
            raise ObjectDoesNotExist("Missing attribute from data: {}".format(data))

        logging.info("Copying node id %s", node_ids)

        nodes = node_ids.split()
        new_nodes = []

        for node_id in nodes:
            print node_id
            new_node = _duplicate_node(node_id, sort_order=sort_order, parent=target_parent)
            new_nodes.append(new_node.pk)
            sort_order+=1

        print " ".join(new_nodes)
        return HttpResponse(json.dumps({
            "success": True,
            "node_ids": " ".join(new_nodes)
        }))

@csrf_exempt
def duplicate_node(request):
    logging.debug("Entering the copy_node endpoint")

    if request.method != 'POST':
        raise HttpResponseBadRequest("Only POST requests are allowed on this endpoint.")
    else:
        data = json.loads(request.body)

        try:
            node_id = data["node_id"]
            sort_order = data["sort_order"]
            target_parent = data["target_parent"]
        except KeyError:
            raise ObjectDoesNotExist("Missing attribute from data: {}".format(data))

        logging.info("Copying node id %s", node_id)

        new_node = _duplicate_node(node_id, sort_order=sort_order, parent=target_parent)
        return HttpResponse(json.dumps({
            "success": True,
            "node_id": new_node.pk
        }))

def _duplicate_node(node, sort_order=1, parent=None):
    if isinstance(node, int) or isinstance(node, basestring):
        node = ContentNode.objects.get(pk=node)
    new_node = ContentNode.objects.create(
        title=node.title,
        description=node.description,
        kind=node.kind,
        license=node.license,
        parent=ContentNode.objects.get(pk=parent) if parent else None,
        sort_order=sort_order,
        license_owner=node.license_owner,
        changed=True,
        original_node=node.original_node,
        cloned_source=node
    )

    # add tags now
    new_node.tags.add(*node.tags.all())

    # copy file object too
    for fobj in node.files.all():
        fobj_copy = copy.copy(fobj)
        fobj_copy.id = None
        fobj_copy.contentnode = new_node
        fobj_copy.save()

    new_node.children = [_duplicate_node(c, parent=None) for c in node.children.all()]
    new_node.save()

    return new_node

@csrf_exempt
def publish_channel(request):
    logging.debug("Entering the publish_channel endpoint")
    if request.method != 'POST':
        raise HttpResponseBadRequest("Only POST requests are allowed on this endpoint.")
    else:
        data = json.loads(request.body)

        try:
            channel_id = data["channel_id"]
        except KeyError:
            raise ObjectDoesNotExist("Missing attribute from data: {}".format(data))

        call_command("exportchannel", channel_id)

        return HttpResponse(json.dumps({
            "success": True,
            "channel": channel_id
        }))

@csrf_exempt
def send_invitation_email(request):
    if request.method != 'POST':
        raise HttpResponseBadRequest("Only POST requests are allowed on this endpoint.")
    else:
        data = json.loads(request.body)

        try:
            user_email = data["user_email"]
            channel_id = data["channel_id"]
            retrieved_user = User.objects.get_or_create(email = user_email)
            recipient = retrieved_user[0]
            channel = Channel.objects.get(id=channel_id)
            invitation = Invitation.objects.get_or_create(invited = recipient,
                                                        email = user_email,
                                                        sender=request.user,
                                                        channel_id = channel_id,
                                                        first_name=recipient.first_name if recipient.is_active else "Guest",
                                                        last_name=recipient.last_name)[0]
            ctx_dict = {    'sender' : request.user,
                            'site' : get_current_site(request),
                            'user' : recipient,
                            'channel_id' : channel_id,
                            'invitation_key': invitation.id,
                            'is_new': recipient.is_active is False,
                            'channel': channel.name
                        }
            subject = render_to_string('permissions/permissions_email_subject.txt', {'site' : get_current_site(request)})
            message = render_to_string('permissions/permissions_email.txt', ctx_dict)
            message_html = render_to_string('permissions/permissions_email.html', ctx_dict)
            recipient.email_user(subject, message, settings.DEFAULT_FROM_EMAIL, html_message=message_html,)
            # recipient.email_user(subject, message, settings.DEFAULT_FROM_EMAIL,)
        except KeyError:
            raise ObjectDoesNotExist("Missing attribute from data: {}".format(data))

        return HttpResponse(json.dumps({
                "success": True,
                "invitation_id": invitation.id
            }))

class InvitationAcceptView(FormView):
    form_class = InvitationAcceptForm
    template_name = 'permissions/permissions_confirm.html'
    invitation = None

    # def get_initial(self):
    #     initial = self.initial.copy()
    #     return {'userid': self.kwargs["user_id"]}

    def get_form_kwargs(self):
        kwargs = super(InvitationAcceptView, self).get_form_kwargs()
        kwargs.update({'user': self.user()})
        return kwargs

    def get_success_url(self):
        return "/channels/" + self.kwargs["channel_id"] + "/edit"

    def dispatch(self, *args, **kwargs):
        user = self.user()
        try:
            self.invitation = Invitation.objects.get(id = self.kwargs['invitation_link'])
        except ObjectDoesNotExist:
            logging.debug("No invitation found.")
            channel = Channel.objects.get(id=self.kwargs["channel_id"])
            if user in channel.editors.all():
                return super(InvitationAcceptView, self).dispatch(*args, **kwargs)
            return redirect("/invitation_fail")

        return super(InvitationAcceptView, self).dispatch(*args, **kwargs)

    def user(self):
        return User.objects.get_or_create(id=self.kwargs["user_id"])[0]

    def form_valid(self, form):
        channel = Channel.objects.get(id=self.kwargs["channel_id"])
        user = self.user()
        if user not in channel.editors.all():
            channel.editors.add(user_id)
            channel.save()
            if self.invitation is not None:
                self.invitation.delete()

        user_cache = authenticate(username=user.email,
                            password=form.cleaned_data['password'],
                        )
        login(self.request, user_cache)

        return redirect(self.get_success_url())

    def form_invalid(self, form):
        return self.render_to_response(self.get_context_data(form=form))

    def get_context_data(self, **kwargs):
        return super(InvitationAcceptView, self).get_context_data(**kwargs)


class InvitationRegisterView(FormView):
    """
    Base class for user registration views.
    """
    disallowed_url = 'registration_disallowed'
    form_class = InvitationForm
    success_url = None
    template_name = 'permissions/permissions_register.html'
    invitation = None

    def get_initial(self):
        initial = self.initial.copy()
        return {'email': self.user().email}

    def get_success_url(self):
        return "/accept_invitation/" + self.kwargs["user_id"] + "/" + self.kwargs["invitation_link"] + "/" + self.kwargs["channel_id"]

    def get_login_url(self):
        return "/channels/" + self.kwargs["channel_id"] + "/edit"

    def dispatch(self, *args, **kwargs):
        user = self.user()
        try:
            self.invitation = Invitation.objects.get(id__exact = self.kwargs['invitation_link'])
        except ObjectDoesNotExist:
            logging.debug("No invitation found.")
            channel = Channel.objects.get(id=self.kwargs["channel_id"])
            if user in channel.editors.all():
                return redirect(self.get_success_url())
            return redirect("/invitation_fail")

        if not getattr(settings, 'REGISTRATION_OPEN', True):
            return redirect(self.disallowed_url)

        if user.is_active:
            return redirect(self.get_success_url())

        return super(InvitationRegisterView, self).dispatch(*args, **kwargs)

    def form_valid(self, form):
        user = form.save(self.user())
        channel = Channel.objects.get(id=self.kwargs["channel_id"])
        if user not in channel.editors.all():
            channel.editors.add(user)
            channel.save()
            if self.invitation is not None:
                self.invitation.delete()
        user_cache = authenticate(username=user.email,
                             password=form.cleaned_data['password1'],
                         )
        login(self.request, user_cache)
        return redirect(self.get_login_url())


    def form_invalid(self, form):

        return self.render_to_response(self.get_context_data(form=form))

    def user(self):
        return User.objects.get_or_create(id=self.kwargs["user_id"])[0]

    def get_context_data(self, **kwargs):
        return super(InvitationRegisterView, self).get_context_data(**kwargs)

def decline_invitation(request, invitation_link):
    try:
        invitation = Invitation.objects.get(id = invitation_link)
        invitation.delete()

    except ObjectDoesNotExist:
        logging.debug("No invitation found.")

    return render(request, 'permissions/permissions_decline.html')

def fail_invitation(request):
    return redirect("/invitation_fail")

class UserRegistrationView(RegistrationView):
    email_body_template = 'registration/activation_email.txt'
    email_subject_template = 'registration/activation_email_subject.txt'
    email_html_template = 'registration/activation_email.html'
    form_class=RegistrationForm

    def send_activation_email(self, user):
        activation_key = self.get_activation_key(user)
        context = self.get_email_context(activation_key)
        context.update({
            'user': user
        })
        subject = render_to_string(self.email_subject_template,
                                   context)
        subject = ''.join(subject.splitlines())
        message = render_to_string(self.email_body_template, context)
        message_html = render_to_string(self.email_html_template, context)
        user.email_user(subject, message, settings.DEFAULT_FROM_EMAIL, html_message=message_html,)