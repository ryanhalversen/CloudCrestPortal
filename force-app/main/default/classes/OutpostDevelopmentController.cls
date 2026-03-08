public without sharing class OutpostDevelopmentController {

    static final List<String> COLUMNS = new List<String>{
        'Scheduled', 'Work In Progress (WIP)', 'In Review', 'In UAT', 'Blocked', 'Completed'
    };
    static final Set<String> EXCLUDED = new Set<String>{ 'Meetings', 'Project Management', 'Helpdesk' };

    // ── Wrapper Classes ───────────────────────────────────────────────────

    public class OutpostData {
        @AuraEnabled public List<StoryWrapper>  ownerStories;
        @AuraEnabled public List<StoryWrapper>  supportStories;
        @AuraEnabled public List<ProjectOption> projects;
        @AuraEnabled public Boolean             isOwner;
        @AuraEnabled public Boolean             isSupport;
    }

    public class StoryWrapper {
        @AuraEnabled public Id      id;
        @AuraEnabled public String  subject;
        @AuraEnabled public String  status;
        @AuraEnabled public String  priority;
        @AuraEnabled public String  type;
        @AuraEnabled public String  ownerName;
        @AuraEnabled public String  supportName;
        @AuraEnabled public String  projectName;
        @AuraEnabled public Id      projectId;
        @AuraEnabled public Decimal hoursLogged;
        @AuraEnabled public Decimal hoursEstimate;
    }

    public class ProjectOption {
        @AuraEnabled public Id     value;
        @AuraEnabled public String label;
    }

    public class CommentWrapper {
        @AuraEnabled public Id       id;
        @AuraEnabled public String   body;
        @AuraEnabled public String   authorName;
        @AuraEnabled public DateTime createdDate;
    }

    // ── getOutpostData ────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static OutpostData getOutpostData(String projectId) {
        Id userId = UserInfo.getUserId();

        String statusList  = '\'' + String.join(COLUMNS, '\',\'') + '\'';
        String excludeList = '\'' + String.join(new List<String>(EXCLUDED), '\',\'') + '\'';
        String projClause  = String.isNotBlank(projectId)
            ? ' AND Projects__c = \'' + String.escapeSingleQuotes(projectId) + '\''
            : '';

        String baseSelect =
            'SELECT Id, Subject, Status, Priority, Type, ' +
            'OwnerId, Owner.Name, Story_Support__c, Story_Support__r.Name, ' +
            'Projects__c, Projects__r.Name, ' +
            'Hours_Estimate_to_Complete__c, Time_Logged_on_Story__c ' +
            'FROM Case';

        String ownerQuery =
            baseSelect +
            ' WHERE OwnerId = \'' + userId + '\'' +
            ' AND Story_Support__c != null' +
            ' AND Status IN (' + statusList + ')' +
            ' AND Subject NOT IN (' + excludeList + ')' +
            projClause +
            ' ORDER BY CreatedDate DESC LIMIT 200';

        String supportQuery =
            baseSelect +
            ' WHERE Story_Support__c = \'' + userId + '\'' +
            ' AND Status IN (' + statusList + ')' +
            ' AND Subject NOT IN (' + excludeList + ')' +
            projClause +
            ' ORDER BY CreatedDate DESC LIMIT 200';

        List<Case> ownerCases   = Database.query(ownerQuery);
        List<Case> supportCases = Database.query(supportQuery);

        List<Sprint__c> sprints = [
            SELECT Id, Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Name ASC
            LIMIT 100
        ];

        List<ProjectOption> projectOptions = new List<ProjectOption>();
        for (Sprint__c s : sprints) {
            ProjectOption po = new ProjectOption();
            po.value = s.Id;
            po.label = s.Name;
            projectOptions.add(po);
        }

        OutpostData data     = new OutpostData();
        data.ownerStories    = toWrappers(ownerCases);
        data.supportStories  = toWrappers(supportCases);
        data.projects        = projectOptions;
        data.isOwner         = !ownerCases.isEmpty();
        data.isSupport       = !supportCases.isEmpty();
        return data;
    }

    private static List<StoryWrapper> toWrappers(List<Case> cases) {
        List<StoryWrapper> result = new List<StoryWrapper>();
        for (Case c : cases) {
            StoryWrapper w  = new StoryWrapper();
            w.id            = c.Id;
            w.subject       = c.Subject;
            w.status        = c.Status;
            w.priority      = c.Priority;
            w.type          = c.Type;
            w.ownerName     = c.Owner != null     ? c.Owner.Name              : null;
            w.supportName   = c.Story_Support__r != null ? c.Story_Support__r.Name : null;
            w.projectName   = c.Projects__r != null ? c.Projects__r.Name      : null;
            w.projectId     = c.Projects__c;
            w.hoursLogged   = c.Time_Logged_on_Story__c != null
                ? (c.Time_Logged_on_Story__c / 60).setScale(2, RoundingMode.HALF_UP)
                : 0;
            w.hoursEstimate = c.Hours_Estimate_to_Complete__c != null
                ? c.Hours_Estimate_to_Complete__c
                : 0;
            result.add(w);
        }
        return result;
    }

    // ── updateStatus ──────────────────────────────────────────────────────

    @AuraEnabled
    public static void updateStatus(String caseId, String newStatus) {
        try {
            Set<String> valid = new Set<String>(COLUMNS);
            if (!valid.contains(newStatus)) {
                throw new AuraHandledException('Invalid status: ' + newStatus);
            }
            update new Case(Id = caseId, Status = newStatus);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── logTime ───────────────────────────────────────────────────────────

    @AuraEnabled
    public static void logTime(String caseId, Integer minutes, String description, String loggedDate) {
        try {
            Case c = [SELECT Epic__c FROM Case WHERE Id = :caseId LIMIT 1];
            Date ld = String.isBlank(loggedDate) ? Date.today() : Date.valueOf(loggedDate);
            Time__c t = new Time__c(
                Case__c                = caseId,
                Epic__c                = c.Epic__c,
                Minutes_Logged__c      = minutes,
                Additional_Comments__c = String.isBlank(description) ? null : description,
                Logged_Date__c         = ld
            );
            insert t;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── postComment ───────────────────────────────────────────────────────

    @AuraEnabled
    public static void postComment(String caseId, String message) {
        try {
            insert new CaseComment(
                ParentId    = caseId,
                CommentBody = message,
                IsPublished = true
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── getComments ───────────────────────────────────────────────────────

    @AuraEnabled
    public static List<CommentWrapper> getComments(String caseId) {
        List<CommentWrapper> result = new List<CommentWrapper>();
        for (CaseComment cc : [
            SELECT Id, CommentBody, CreatedBy.Name, CreatedDate
            FROM CaseComment
            WHERE ParentId = :caseId
            ORDER BY CreatedDate ASC
            LIMIT 200
        ]) {
            CommentWrapper w = new CommentWrapper();
            w.id         = cc.Id;
            w.body       = cc.CommentBody;
            w.authorName = cc.CreatedBy.Name;
            w.createdDate = cc.CreatedDate;
            result.add(w);
        }
        return result;
    }
}
