# Treatable privacy policy

Effective date: October 24, 2026

Treatable is a Chrome extension that helps you understand public clinical studies on ClinicalTrials.gov. It is research information, not medical advice. This policy explains what the extension handles, where it goes, and what stays on your device.

Operator: Kurt Lehnardt - Developer of Treatable
Privacy contact: privacy.6vpc5@mailer.me

## The short version

- The developer runs no servers and receives none of your data. There are no analytics, ads, trackers, or data sales.
- Details you type about yourself stay on your device, in memory, for the current session only.
- When you click "Generate study brief", public study text from ClinicalTrials.gov is sent to OpenAI through a helper program on your computer, using your own OpenAI API key. Your personal details are not included.

## Where Treatable works

Treatable only runs on https://clinicaltrials.gov and https://www.clinicaltrials.gov. It does not read or change any other website.

## Information you enter

In "Your details" you can enter your name, a description of your condition, symptoms or reason for seeking treatment, and anything else you want to include. You can also enter a ZIP code to estimate the distance to study sites.

- This information is kept in memory on your device and is used only to fill your own email, call script and follow-up drafts.
- It is not written to disk by the extension and is cleared when you end the session, close Treatable, or reload the page.
- The extension never sends it to OpenAI, to ClinicalTrials.gov, or to the developer.
- When you choose to open a draft in your email app, copy it, or tap a Call button, the draft or phone number is handed to the app you choose on your own device. Treatable never sends an email or places a call for you.

## Information stored on your device

Treatable stores only interface settings in Chrome's extension storage on your device:

- your display mode and theme;
- a number recording that you finished or skipped the first-run guide;
- during a browsing session only, the current step of the guide.

It does not store searches, study lists, health details, names or other text you type.

## Information sent to OpenAI

When you click "Generate study brief", a helper program installed on your computer sends the following to the OpenAI API (the Agents and Decisions APIs), using an OpenAI API key that you provide and that is kept in your computer's keychain:

- the IDs of the one or two studies you selected; and
- text from those studies' official public records on ClinicalTrials.gov.

Your name, contact details, ZIP code, notes and the details you entered are not included.

If the extension offers an optional profile-based analysis and you choose to use it, it first shows a privacy notice and the exact information to be sent, and asks you to confirm. In that case only a minimized profile (for example an age range, sex, a US state and condition terms) is sent. Minimized health information can still be sensitive and is not anonymous.

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
