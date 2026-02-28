// Create overhead stories (Meetings, Project Management, Helpdesk) for every In Progress Sprint__c
// - Skips any project that already has a story with that exact subject
// - These stories are hidden from the storyboard and surfaced only via the management panel

List<Sprint__c> projects = [
    SELECT Id, Name
    FROM Sprint__c
    WHERE Status__c = 'In Progress'
    ORDER BY Name ASC
];

if (projects.isEmpty()) {
    System.debug('No In Progress projects found. Nothing to do.');
    return;
}

Set<Id> projectIds = new Map<Id, Sprint__c>(projects).keySet();
List<String> overheadSubjects = new List<String>{ 'Meetings', 'Project Management', 'Helpdesk' };

// Build a set of "projectId|subject" keys for stories that already exist
Set<String> existingKeys = new Set<String>();
for (Case c : [
    SELECT Projects__c, Subject
    FROM Case
    WHERE Projects__c IN :projectIds
    AND Subject IN :overheadSubjects
]) {
    existingKeys.add((String) c.Projects__c + '|' + c.Subject);
}

// Map projectId → Needs Assignment epic Id for attachment
Map<Id, Id> epicByProject = new Map<Id, Id>();
for (Sprint_Items__c epic : [
    SELECT Id, Projects_new__c
    FROM Sprint_Items__c
    WHERE Name = 'Needs Assignment'
    AND Projects_new__c IN :projectIds
]) {
    epicByProject.put(epic.Projects_new__c, epic.Id);
}

List<Case> toInsert = new List<Case>();
for (Sprint__c p : projects) {
    for (String subject : overheadSubjects) {
        if (!existingKeys.contains((String) p.Id + '|' + subject)) {
            toInsert.add(new Case(
                Subject     = subject,
                Projects__c = p.Id,
                Status      = 'Work In Progress (WIP)',
                Epic__c     = epicByProject.get(p.Id)
            ));
        }
    }
}

if (toInsert.isEmpty()) {
    System.debug('All In Progress projects already have overhead stories. Nothing created.');
    return;
}

insert toInsert;
System.debug('SUCCESS: Created ' + toInsert.size() + ' overhead stories across ' + projects.size() + ' projects.');
for (Case c : toInsert) {
    System.debug('  Created "' + c.Subject + '" on project ' + c.Projects__c);
}
