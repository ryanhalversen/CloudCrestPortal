@isTest
public class TeamCapacityControllerTest {

    @TestSetup
    static void setup() {
        Sprint__c s1 = new Sprint__c(
            Name                     = 'Capacity Project A',
            Status__c                = 'In Progress',
            Weekly_Pace_Estimate__c  = 10
        );
        Sprint__c s2 = new Sprint__c(
            Name                     = 'Capacity Project B',
            Status__c                = 'In Progress',
            Weekly_Pace_Estimate__c  = 8
        );
        Sprint__c s3 = new Sprint__c(
            Name      = 'Completed Project',
            Status__c = 'Completed'
        );
        insert new List<Sprint__c>{ s1, s2, s3 };
    }

    @isTest
    static void testGetCapacityData_returnsActiveProjects() {
        Test.startTest();
        TeamCapacityController.CapacityData result = TeamCapacityController.getCapacityData();
        Test.stopTest();

        System.assertNotEquals(null, result,              'Result should not be null');
        System.assertNotEquals(null, result.projects,    'Projects list should not be null');
        System.assertNotEquals(null, result.weeklyHours, 'Weekly hours list should not be null');

        // Only the 2 In Progress projects should be returned
        Integer activeCount = 0;
        for (TeamCapacityController.ProjectWrapper p : result.projects) {
            System.assertNotEquals(null, p.id,   'Project Id should be set');
            System.assertNotEquals(null, p.name, 'Project name should be set');
            activeCount++;
        }
        System.assert(activeCount >= 2, 'Should return at least 2 active projects');
    }

    @isTest
    static void testGetCapacityData_weeklyHours() {
        Sprint__c s = [SELECT Id FROM Sprint__c WHERE Name = 'Capacity Project A' LIMIT 1];
        Sprint_Items__c epic = new Sprint_Items__c(Name = 'Test Epic', Projects_new__c = s.Id);
        insert epic;
        Case c = new Case(Subject = 'Test Story', Projects__c = s.Id, Epic__c = epic.Id);
        insert c;
        insert new Time__c(
            Case__c           = c.Id,
            Epic__c           = epic.Id,
            Minutes_Logged__c = 120,
            Logged_Date__c    = Date.today()
        );

        Test.startTest();
        TeamCapacityController.CapacityData result = TeamCapacityController.getCapacityData();
        Test.stopTest();

        Boolean foundCurrentUser = false;
        for (TeamCapacityController.UserHoursWrapper w : result.weeklyHours) {
            if (w.userId == UserInfo.getUserId()) {
                foundCurrentUser = true;
                System.assert(w.hours >= 2, 'Should have at least 2h logged this week');
            }
        }
        System.assert(foundCurrentUser, 'Current user should appear in weekly hours');
    }

    @isTest
    static void testGetCapacityData_projectFields() {
        Test.startTest();
        TeamCapacityController.CapacityData result = TeamCapacityController.getCapacityData();
        Test.stopTest();

        TeamCapacityController.ProjectWrapper proj = null;
        for (TeamCapacityController.ProjectWrapper p : result.projects) {
            if (p.name == 'Capacity Project A') { proj = p; break; }
        }
        System.assertNotEquals(null, proj, 'Should find Capacity Project A');
        System.assertEquals(10, proj.weeklyPace,   'Weekly pace should be 10');
        System.assertNotEquals(null, proj.ownerId,  'OwnerId should be set');
        System.assertNotEquals(null, proj.ownerName,'Owner name should be set');
    }
}
