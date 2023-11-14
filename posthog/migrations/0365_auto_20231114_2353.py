# Generated by Django 3.2.19 on 2023-11-14 23:53

from django.db import migrations, models
import django.db.models.deletion
import django.db.models.expressions


class Migration(migrations.Migration):
    dependencies = [
        ("posthog", "0364_auto_20231114_2352"),
    ]

    operations = [
        migrations.CreateModel(
            name="PersonOverride",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("old_person_id", models.UUIDField()),
                ("override_person_id", models.UUIDField()),
                ("oldest_event", models.DateTimeField()),
                ("version", models.BigIntegerField(blank=True, null=True)),
                ("team", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="posthog.team")),
            ],
        ),
        migrations.AddConstraint(
            model_name="personoverride",
            constraint=models.UniqueConstraint(
                fields=("team", "old_person_id"), name="unique override per old_person_id"
            ),
        ),
        migrations.AddConstraint(
            model_name="personoverride",
            constraint=models.CheckConstraint(
                check=models.Q(
                    ("old_person_id__exact", django.db.models.expressions.F("override_person_id")), _negated=True
                ),
                name="old_person_id_different_from_override_person_id",
            ),
        ),
    ]
