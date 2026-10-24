import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import {PrivacyNotice} from '../src/privacy-notice';
test('notice explains early pointer and keyboard acknowledgment without accepting before the bottom',()=>{
 let accepted=0;let renderer!:TestRenderer.ReactTestRenderer;
 act(()=>{renderer=TestRenderer.create(React.createElement(PrivacyNotice,{accepted:false,disabled:false,onAccept:()=>accepted++}))});
 const button=()=>renderer.root.findAllByType('button').at(-1)!,checkbox=()=>renderer.root.findByType('input');
 assert.equal(button().props.disabled,true);assert.equal(checkbox().props.disabled,false);
 act(()=>checkbox().props.onChange({target:{checked:true}}));
 assert.equal(checkbox().props.checked,false);assert.equal(button().props.disabled,true);assert.equal(accepted,0);
 assert.equal(renderer.root.findByProps({role:'alert'}).children.join(''),'Please scroll down to the bottom of the terms.');
 assert.equal(checkbox().props['aria-describedby'],'privacy-scroll-help');
 let prevented=false;act(()=>checkbox().props.onKeyDown({key:' ',preventDefault(){prevented=true}}));assert.ok(prevented);
 act(()=>button().props.onClick());assert.equal(accepted,0);
 const region=renderer.root.findByProps({role:'region'});act(()=>region.props.onScroll({currentTarget:{scrollHeight:1000,scrollTop:100,clientHeight:320}}));
 assert.equal(button().props.disabled,true);act(()=>region.props.onScroll({currentTarget:{scrollHeight:1000,scrollTop:680,clientHeight:320}}));
 assert.equal(renderer.root.findAllByProps({role:'alert'}).length,0);assert.equal(button().props.disabled,true);
 act(()=>checkbox().props.onChange({target:{checked:true}}));assert.equal(button().props.disabled,false);
 act(()=>button().props.onClick());assert.equal(accepted,1);act(()=>renderer.unmount());
});
test('notice names the supplied operator/contact and distinguishes minimized from anonymous',()=>{const renderer=TestRenderer.create(React.createElement(PrivacyNotice,{accepted:false,disabled:true,onAccept:()=>assert.fail('blocked')}));const text=JSON.stringify(renderer.toJSON());assert.match(text,/Kurt Lehnardt - Developer of Treatable/);assert.match(text,/privacy.6vpc5@mailer.me/);assert.match(text,/Minimized information is not anonymous/);assert.match(text,/up to 30 days/);assert.match(text,/until deletion/);const live=TestRenderer.create(React.createElement(PrivacyNotice,{mode:'live',accepted:false,disabled:true,onAccept:()=>{}}));assert.match(JSON.stringify(live.toJSON()),/nearest-site\/distance summaries/);live.unmount();assert.equal(renderer.root.findByType('input').props.disabled,true);renderer.unmount()});
