# Treatable privacy policy

Effective date: October 24, 2026

Treatable is a Chrome extension that helps you understand public clinical studies on ClinicalTrials.gov. It is research information, not medical advice. This policy explains what the extension handles, where it goes, and what stays on your device.

Operator: Kurt Lehnardt - Developer of Treatable
Privacy contact: privacy.6vpc5@mailer.me

## The short version

- The developer runs no servers and receives none of your data. There are no analytics, ads, trackers, or data sales.
- Details you type about yourself stay on your device, in memory, for the current session only.
- When you click "Generate study brief", public study text from ClinicalTrials.gov is sent to OpenAI through a helper program on your computer, using your own OpenAI API key. Your personal details are not included.
- With AI-matched results (on by default, and you can turn it off), the condition you searched for, short condition terms from "Your details" if you entered a condition, and the public records of the studies on the page are sent to OpenAI through the helper, after you allow it once per browser session.
- If you choose the local model option, briefs and rankings are produced by a model running on your own computer and nothing is sent to OpenAI.

## Where Treatable works

Treatable only runs on https://clinicaltrials.gov and https://www.clinicaltrials.gov. It does not read or change any other website.

## Information you enter

In "Your details" you can enter your name, an age range, your sex, a description of your condition, symptoms or reason for seeking treatment, and anything else you want to include. You can also enter a ZIP code to estimate the distance to study sites.

- This information is kept in memory on your device and is used only to fill your own email, call script and follow-up drafts.
- It is not written to disk by the extension and is cleared when you end the session, close Treatable, or reload the page.
- The extension never sends your name, notes, ZIP code, age range or sex to OpenAI, to ClinicalTrials.gov, or to the developer. Your age range and sex are used only on your device, to move studies that clearly do not match to the end of the list.
- If you entered a condition, short condition terms taken from it are shown to you and used for AI-matched results as described below.
- When you choose to open a draft in your email app, copy it, or tap a Call button, the draft or phone number is handed to the app you choose on your own device. Treatable never sends an email or places a call for you.

## Information stored on your device

Treatable stores only interface settings in Chrome's extension storage on your device:

- your display mode and theme;
- whether AI-matched results is on, and which model provider and local model you chose;
- a number recording that you finished or skipped the first-run guide;
- during a browsing session only, the current step of the guide, and a marker that you allowed AI-matched results for that session.

It does not store searches, study lists, health details, names or other text you type.

## Information sent to OpenAI

When you click "Generate study brief", a helper program installed on your computer sends the following to the OpenAI API (the Agents and Decisions APIs), using an OpenAI API key that you provide and that is kept in your computer's keychain:

- the IDs of the one or two studies you selected; and
- text from those studies' official public records on ClinicalTrials.gov.

Your name, contact details, ZIP code, notes and the details you entered are not included.

**AI-matched results.** When AI-matched results is on and you use OpenAI, the first ranking in a browser session shows a privacy notice and the exact information to be sent, and asks you to allow it for that session. After that, results pages are ranked automatically until the browser closes or you turn the feature off. Each ranking sends only the condition you searched for, short condition terms from "Your details" if you entered a condition, and the public records of up to ten studies on the page. The OpenAI Decisions API scores how relevant each study looks; it does not decide eligibility. Condition terms are health information and are not anonymous.

Match percentages show how relevant a study looks to your search and details. They are not a medical opinion and do not decide eligibility; only the study team can.

## Local model option

If you choose "Local model (Ollama on this device)", the helper runs a model on your own computer with Ollama for study briefs and AI-matched results. Nothing is sent to OpenAI, your OpenAI API key is not used, and the local model service the helper starts only listens on your own computer.

OpenAI processes this data under its own terms and policies (https://openai.com/policies). OpenAI's Agents API keeps conversation state until it is deleted; Treatable asks OpenAI to delete each session after use and shows you whether deletion was confirmed, but it cannot guarantee immediate or complete erasure. OpenAI may keep API data for a limited time for abuse monitoring, as described in its policies.

## Information sent to ClinicalTrials.gov

Treatable fetches public study records from ClinicalTrials.gov, which is operated by the U.S. National Library of Medicine. Those requests, like your normal use of the site, are covered by ClinicalTrials.gov's own policies.

## Security and limits

Your OpenAI API key is never stored in the browser. Treatable is designed to keep personal details out of network requests, but no software can protect against a compromised computer, browser or operating system. Treatable does not claim compliance with HIPAA or other health privacy laws.

## Children

Treatable is not directed to children under 13.

## Changes

If this policy changes, the effective date above will be updated and the new version will be published at this address.

## Contact

Questions or requests: privacy.6vpc5@mailer.me
