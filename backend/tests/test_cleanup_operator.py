import json
from tools import cleanup_uploads as operator


def test_dry_run_never_connects(monkeypatch, capsys):
    monkeypatch.setattr(operator, 'UploadGateway', lambda token: (_ for _ in ()).throw(AssertionError('No connection allowed')))
    assert operator.main(['--json']) == 0
    assert json.loads(capsys.readouterr().out)['mode'] == 'dry-run'


def gateway(monkeypatch, rows):
    class FakeGateway:
        closed = False
        def rpc(self, name, privileged=False):
            assert name == 'claim_upload_orphans' and privileged
            return rows
        def close(self):
            self.closed = True
    instance = FakeGateway()
    monkeypatch.setattr(operator, 'UploadGateway', lambda token: instance)
    return instance


def test_all_cleaned_returns_success_and_counts(monkeypatch, capsys):
    instance = gateway(monkeypatch, [1, 2])
    monkeypatch.setattr(operator, 'cleanup', lambda g, row, state: state == 'deleted')
    assert operator.main(['--apply', '--json']) == 0
    assert json.loads(capsys.readouterr().out) == {'mode': 'apply', 'status': 'ok', 'claimed': 2, 'removed': 2, 'failed': 0}
    assert instance.closed


def test_partial_failure_is_visible_to_scheduler(monkeypatch, capsys):
    instance = gateway(monkeypatch, [1, 2])
    monkeypatch.setattr(operator, 'cleanup', lambda g, row, state: row == 1)
    assert operator.main(['--apply', '--json']) == 1
    result = json.loads(capsys.readouterr().out)
    assert result['status'] == 'retry_required' and result['failed'] == 1 and result['removed'] == 1
    assert instance.closed


def test_provider_failure_never_prints_credentials(monkeypatch, capsys):
    instance = gateway(monkeypatch, [])
    def fail(*args, **kwargs):
        raise RuntimeError('secret-token private/object-path provider-response')
    monkeypatch.setattr(instance, 'rpc', fail)
    assert operator.main(['--apply', '--json']) == 1
    output = capsys.readouterr().out
    assert json.loads(output)['status'] == 'error'
    assert 'secret-token' not in output and 'private/object-path' not in output
    assert instance.closed


def test_invalid_batch_fails_before_object_operations(monkeypatch, capsys):
    instance = gateway(monkeypatch, [None] * 101)
    monkeypatch.setattr(operator, 'cleanup', lambda *args: (_ for _ in ()).throw(AssertionError('Cannot remove oversized batch')))
    assert operator.main(['--apply', '--json']) == 1
    assert json.loads(capsys.readouterr().out)['status'] == 'error'
    assert instance.closed
